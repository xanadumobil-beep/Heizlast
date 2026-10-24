// Bericht: Vorschau auf dem Bildschirm und Druck (auf dem iPad: Drucken, dann als PDF sichern).
// Den Inhalt baut js/bericht.js, das Druck-Layout steht in css/print.css.

import { el, ersetzeKinder } from '../ui.js';
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
        'tr', { class: b.summenzeile && r === b.zeilen.length - 1 ? 'summe' : '' },
        zeile.map((zelle, i) => el(i === 0 ? 'th' : 'td', { class: klasse(i), scope: i === 0 ? 'row' : undefined }, zelle)),
      ))),
    ),
  );
}

function block(b) {
  switch (b.art) {
    case 'text': return el('p', { class: 'b-text' }, b.text);
    case 'box': return el('p', { class: `b-box ${b.stufe}`, role: 'note' }, b.stufe === 'hinweis' ? el('strong', {}, 'Hinweis: ') : null, b.text);
    case 'zwischentitel': return el('h3', { class: 'b-zwischentitel' }, b.text);
    case 'liste': return el('ul', { class: 'b-liste' }, b.eintraege.map((t) => el('li', {}, t)));
    case 'paare': return el('dl', { class: 'b-paare' }, b.zeilen.flatMap(([name, wert]) => [el('dt', {}, name), el('dd', {}, wert)]));
    case 'tabelle': return tabelle(b);
    case 'plan': return el('div', { class: 'b-plan' }, zeichnePlan(geometrie(b.plan, { bezuege: 'zonen' })), legende());
    default: throw new Error(`Unbekannter Blocktyp: ${b.art}`);
  }
}

export function berichtElement(bericht) {
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
      a.bloecke.map(block),
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
function baueGewaehlt(wahl, ist, szenarien, jetzt) {
  if (wahl === 'vergleich') return baueVergleichsBericht(ist, szenarien, jetzt);
  if (wahl.startsWith('szenario:')) {
    const sz = szenarien.find((x) => `szenario:${x.id}` === wahl);
    if (sz) return baueBericht(wendeSzenarioAn(ist, sz).projekt, jetzt, { szenario: szenarioInfo(ist, sz) });
  }
  return baueBericht(ist, jetzt);
}

export async function renderBericht(container) {
  const [ist, szenarien, aktiv] = await Promise.all([ladeIstProjekt(), ladeSzenarien(), ladeAktivesSzenario()]);
  const jetzt = new Date();
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
  const zeige = () => {
    bericht = baueGewaehlt(wahl, ist, szenarien, jetzt);
    ersetzeKinder(vorschau, berichtElement(bericht));
  };
  auswahlFeld.addEventListener('change', () => { wahl = auswahlFeld.value; zeige(); });

  ersetzeKinder(
    container,
    el(
      'div', { class: 'keinDruck' },
      el('div', { class: 'kopf' }, el('h2', {}, 'Bericht'), el('button', { type: 'button', class: 'primaer', 'data-lesen': true, onClick: () => drucken(bericht.seitentitel) }, 'Drucken / als PDF sichern')),
      el('label', { class: 'berichtwahl' }, el('span', { class: 'klein' }, 'Inhalt des Berichts'), auswahlFeld),
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
  zeige();
}
