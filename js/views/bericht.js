// Bericht: Vorschau auf dem Bildschirm und Druck (auf dem iPad: Drucken, dann als PDF sichern).
// Den Inhalt baut js/bericht.js, das Druck-Layout steht in css/print.css.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { datumKurz, fotoAnhang, sortiereFotos } from '../foto.js';
import { ladeIstProjekt, ladeSzenarien, ladeAktivesSzenario } from '../daten.js';
import { baueBericht, baueVergleichsBericht } from '../bericht.js';
import { wendeSzenarioAn, szenarioInfo } from '../szenario.js';
import { geometrie } from '../planlayout.js';
import { zeichnePlan, legende } from '../planzeichnung.js';

function tabelle(b) {
  const klasse = (i) => (b.ausrichtung[i] === 'r' ? 'r' : '');
  return el(
    'div', { class: 'b-tabelle' },
    el(
      'table', { class: b.kopf.length > 8 ? 'breit' : '' },
      el('thead', {}, el('tr', {}, b.kopf.map((k, i) => el('th', { class: klasse(i), scope: 'col' }, k)))),
      el('tbody', {}, b.zeilen.map((zeile, r) => el(
        'tr', { class: `${b.summenzeile && r === b.zeilen.length - 1 ? 'summe' : ''}${(b.hervor ?? []).includes(r) ? ' hervor' : ''}` },
        zeile.map((zelle, i) => el(i === 0 ? 'th' : 'td', { class: klasse(i), scope: i === 0 ? 'row' : undefined }, zelle)),
      ))),
    ),
  );
}

// Foto mit nummerierten Markierungen (Position in Prozent) und einer Legende darunter.
function fotoBlock(eintrag, ctx) {
  const adresse = ctx.fotoUrls?.get(eintrag.fotoId);
  return el(
    'figure', { class: 'b-foto' },
    el('figcaption', { class: 'b-foto-kopf' }, el('strong', {}, eintrag.raumName), ` · ${eintrag.titel || 'Foto'}${eintrag.datum ? ` · ${datumKurz(eintrag.datum)}` : ''}`),
    el(
      'div', { class: 'b-foto-bild' },
      adresse ? el('img', { src: adresse, alt: eintrag.titel || 'Foto' }) : el('p', { class: 'zeile' }, 'Bild nicht verfügbar'),
      eintrag.markierungen.map((m) => el('span', { class: `b-marke${m.fehlt ? ' fehlt' : ''}`, style: `left: ${m.x}%; top: ${m.y}%` }, String(m.nr))),
    ),
    eintrag.markierungen.length > 0
      ? el('ol', { class: 'b-foto-legende' }, eintrag.markierungen.map((m) => el('li', { value: m.nr }, `${m.text}${m.fehlt ? ' (Verknüpfung fehlt)' : ''}`)))
      : null,
    eintrag.notiz ? el('p', { class: 'b-foto-notiz' }, eintrag.notiz) : null,
  );
}

function block(b, ctx = {}) {
  switch (b.art) {
    case 'text': return el('p', { class: 'b-text' }, b.text);
    case 'box': return el('p', { class: `b-box ${b.stufe}`, role: 'note' }, b.stufe === 'hinweis' ? el('strong', {}, 'Hinweis: ') : null, b.text);
    case 'zwischentitel': return el('h3', { class: 'b-zwischentitel' }, b.text);
    case 'liste': return el('ul', { class: 'b-liste' }, b.eintraege.map((t) => el('li', {}, t)));
    case 'paare': return el('dl', { class: 'b-paare' }, b.zeilen.flatMap(([name, wert]) => [el('dt', {}, name), el('dd', {}, wert)]));
    case 'tabelle': return tabelle(b);
    case 'plan': return el('div', { class: 'b-plan' }, zeichnePlan(geometrie(b.plan, { bezuege: 'zonen', hintergruende: ctx.hintergruende ?? new Map() }), { hintergrundUrls: ctx.hintergrundUrls ?? new Map() }), legende());
    case 'fotos': return el('div', { class: 'b-fotos' }, b.eintraege.map((e) => fotoBlock(e, ctx)));
    default: throw new Error(`Unbekannter Blocktyp: ${b.art}`);
  }
}

export function berichtElement(bericht, ctx = {}) {
  return el(
    'article', { class: 'bericht' },
    el(
      'header', { class: 'b-kopf' },
      el('h1', {}, bericht.titel),
      el('p', { class: 'b-projekt' }, el('strong', {}, bericht.projektname), ` · erstellt am ${bericht.erstelltAm}`),
      el('p', { class: 'b-haftung' }, bericht.haftungshinweis),
    ),
    bericht.abschnitte.map((a) => el(
      'section', { class: a.neueSeite ? 'b-abschnitt neue-seite' : 'b-abschnitt' },
      el('h2', {}, a.titel),
      a.bloecke.map((b) => block(b, ctx)),
    )),
  );
}

// Der Seitentitel wird beim Drucken zum Namen der PDF-Datei.
function drucken(titel) {
  const bisher = document.title;
  document.title = titel;
  const zurueck = () => {
    document.title = bisher;
    window.removeEventListener('afterprint', zurueck);
  };
  window.addEventListener('afterprint', zurueck);
  window.print();
}

// Inhalt des Berichts: 'ist', 'szenario:<id>' oder 'vergleich'.
function baueGewaehlt(wahl, ist, szenarien, jetzt, extra = {}) {
  if (wahl === 'vergleich') return baueVergleichsBericht(ist, szenarien, jetzt);
  if (wahl.startsWith('szenario:')) {
    const sz = szenarien.find((x) => `szenario:${x.id}` === wahl);
    if (sz) return baueBericht(wendeSzenarioAn(ist, sz).projekt, jetzt, { szenario: szenarioInfo(ist, sz), ...extra });
  }
  return baueBericht(ist, jetzt, extra);
}

export async function renderBericht(container) {
  const [ist, szenarien, aktiv, fotos, hintergruendeListe] = await Promise.all([ladeIstProjekt(), ladeSzenarien(), ladeAktivesSzenario(), db.alle('photos'), db.alle('backgrounds')]);
  const jetzt = new Date();
  const hintergruende = new Map(hintergruendeListe.map((b) => [b.geschoss, b]));
  const fotoUrls = new Map();
  const hintergrundUrls = new Map();
  const adresse = (karte, schluessel, blob) => {
    if (!karte.has(schluessel)) karte.set(schluessel, URL.createObjectURL(blob));
    return karte.get(schluessel);
  };
  let mitFotos = false;
  let mitBauplan = false;
  const fotoWahl = {};
  let wahl = aktiv ? `szenario:${aktiv.id}` : 'ist';
  const vorschau = el('div', {});

  const optionen = [
    { wert: 'ist', text: 'Ist-Zustand' },
    ...szenarien.map((s) => ({ wert: `szenario:${s.id}`, text: `Szenario: ${s.name}` })),
    ...(szenarien.length > 0 ? [{ wert: 'vergleich', text: 'Szenarienvergleich (alle Szenarien)' }] : []),
  ];
  const auswahlFeld = el('select', { 'aria-label': 'Inhalt des Berichts' }, optionen.map((o) => el('option', { value: o.wert }, o.text)));
  auswahlFeld.value = wahl;

  let bericht = null;
  // Zusätzliche Inhalte: Fotoanhang (ein Foto je Raum mit Markierungen) und Bauplan im Plan. Nur für Ist-Zustand und Szenarien.
  const zusatz = el('div', { class: 'berichtzusatz' });
  const zeigeZusatz = () => {
    const raeumeMitFotos = ist.raeume.filter((r) => fotos.some((f) => f.raumId === r.id));
    zusatz.hidden = wahl === 'vergleich';
    const fotoCheck = el('input', { type: 'checkbox', checked: mitFotos || undefined, 'aria-label': 'Fotoanhang' });
    fotoCheck.addEventListener('change', () => { mitFotos = fotoCheck.checked; zeigeZusatz(); zeige(); });
    const bauplanCheck = el('input', { type: 'checkbox', checked: mitBauplan || undefined, 'aria-label': 'Bauplan im Plan' });
    bauplanCheck.addEventListener('change', () => { mitBauplan = bauplanCheck.checked; zeige(); });
    ersetzeKinder(
      zusatz,
      raeumeMitFotos.length > 0
        ? el('label', { class: 'behalten' }, fotoCheck, ` Anhang mit Fotos (ein Foto je Raum, mit Markierungen; ${raeumeMitFotos.length} Raum/Räume haben Fotos)`)
        : el('p', { class: 'zeile' }, 'Fotoanhang: Es gibt noch keine Fotos.'),
      mitFotos ? el('div', { class: 'fotowahl' }, raeumeMitFotos.map((r) => {
        const eigene = sortiereFotos(fotos.filter((f) => f.raumId === r.id));
        const wahlFeld = el('select', { 'aria-label': `Foto für ${r.name}` }, eigene.map((f) => el('option', { value: f.id }, f.titel || 'Foto')));
        wahlFeld.value = fotoWahl[r.id] ?? eigene[0].id;
        wahlFeld.addEventListener('change', () => { fotoWahl[r.id] = wahlFeld.value; zeige(); });
        return el('label', {}, el('span', { class: 'klein' }, r.name), wahlFeld);
      })) : null,
      hintergruende.size > 0
        ? el('label', { class: 'behalten' }, bauplanCheck, ' Bauplan als Hintergrund im Plan abbilden (vergrößert die PDF-Datei)')
        : null,
    );
  };

  const zeige = () => {
    const extra = mitFotos ? { fotoAnhang: fotoAnhang(ist, ist.fotoInfos, ist.markierungen, fotoWahl) } : {};
    bericht = baueGewaehlt(wahl, ist, szenarien, jetzt, extra);
    const ctx = {
      fotoUrls: new Map(fotos.filter((f) => extra.fotoAnhang?.some((e) => e.fotoId === f.id)).map((f) => [f.id, adresse(fotoUrls, f.id, f.blob)])),
      hintergruende: mitBauplan ? hintergruende : new Map(),
      hintergrundUrls: mitBauplan ? new Map([...hintergruende].map(([g, b]) => [g, adresse(hintergrundUrls, g, b.blob)])) : new Map(),
    };
    ersetzeKinder(vorschau, berichtElement(bericht, ctx));
  };
  auswahlFeld.addEventListener('change', () => { wahl = auswahlFeld.value; zeigeZusatz(); zeige(); });

  ersetzeKinder(
    container,
    el(
      'div', { class: 'keinDruck' },
      el('div', { class: 'kopf' }, el('h2', {}, 'Bericht'), el('button', { type: 'button', class: 'primaer', 'data-lesen': true, onClick: () => drucken(bericht.seitentitel) }, 'Drucken / als PDF sichern')),
      el('label', { class: 'berichtwahl' }, el('span', { class: 'klein' }, 'Inhalt des Berichts'), auswahlFeld),
      zusatz,
      el(
        'p', { class: 'beschreibung' },
        'So sieht der Ausdruck aus. Er enthält Projektdaten, Bauteilkatalog, Räume mit Heizlast, Heizkörper mit Vorlauftemperaturen, '
        + 'die Gebäudeheizlast als Bandbreite, den Verbrauchsabgleich und alle Annahmen. Gewählt wird der Ist-Zustand, ein Szenario oder der Szenarienvergleich.',
      ),
      el(
        'details', { class: 'karte hilfe' },
        el('summary', {}, 'So sicherst du den Bericht als PDF auf dem iPad'),
        el(
          'ol', {},
          el('li', {}, 'Tippe auf „Drucken / als PDF sichern“. Es erscheint die Druckansicht mit einer Vorschau.'),
          el('li', {}, 'Zieh mit zwei Fingern auf der Vorschau auseinander. Dann öffnet sich die Seite als PDF.'),
          el('li', {}, 'Tippe auf das Teilen-Symbol und wähle „In Dateien sichern“, zum Beispiel in iCloud Drive.'),
          el('li', {}, 'Kopf- und Fußzeile (Adresse, Datum, „Seite x von y“) und den Dateinamen setzt iOS selbst. Beim Sichern in Dateien kannst du die Datei umbenennen.'),
          el('li', {}, 'Passiert nach dem ersten Schritt nichts (das kommt bei Web-Apps vom Home-Bildschirm vor): Öffne die Seite in Safari, tippe dort auf Teilen und wähle „Drucken“.'),
        ),
      ),
    ),
    vorschau,
  );
  zeigeZusatz();
  zeige();
}
