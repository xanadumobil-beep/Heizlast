// Szenarien: Liste mit Vergleich, Szenario-Editor mit Ist- und Szenario-Wert nebeneinander.
// Der Ist-Zustand wird hier nie geschrieben. Gespeichert werden nur Szenarien (Store "scenarios").

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { oeffneDialog } from '../dialog.js';
import { parseDezimal, zahlZuText } from '../engine/format.js';
import { ladeIstProjekt, ladeSzenarien, ladeAktivesSzenario, setzeAktivesSzenario } from '../daten.js';
import {
  kostenNachFoerderung, neuesSzenario, kopiereSzenario, normalisiereSzenario, beschreibeAbweichungen, validiereSzenario, zaehleAbweichungen, wendeSzenarioAn,
} from '../szenario.js';
import { baueVergleich, vergleichTabellen, bandText } from '../vergleich.js';
import { vergleichsannahmen, loeseGradtageAuf, JAHRESHINWEIS } from '../jahreswaerme.js';
import { mittlereInnentemperatur } from '../modell.js';
import { hatFehler, hatWarnungen, validiereHeizkoerper } from '../validate.js';
import { parseKennlinie, kennlinieZuText } from '../modell.js';
import {
  label, BAUARTEN_HK, HK_STATI, VENTILE, werte, neuerHeizkoerper, heizkoerperFelder, normWahlVon,
} from '../schemas.js';

const OPTIONEN = { bauarten: werte(BAUARTEN_HK), stati: werte(HK_STATI), ventile: werte(VENTILE) };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const bereichText = (b) => (b.min === b.max ? zahlZuText(b.min) : `${zahlZuText(b.min)} – ${zahlZuText(b.max)}`);

// --- Bausteine -------------------------------------------------------------------------------

function tabelle({ kopf, zeilen, ausrichtung = '', summenzeile = false, hervor = [] }) {
  return el(
    'div', { class: 'tabellenrahmen' },
    el(
      'table', { class: 'tabelle vergleich-tabelle' },
      el('thead', {}, el('tr', {}, kopf.map((k) => el('th', { scope: 'col' }, k)))),
      el('tbody', {}, zeilen.map((zeile, r) => el(
        'tr', { class: `${summenzeile && r === zeilen.length - 1 ? 'summe' : ''}${hervor.includes(r) ? ' hervor' : ''}` },
        zeile.map((zelle, i) => el(i === 0 ? 'th' : 'td', { class: ausrichtung[i] === 'r' ? 'zahl' : '', scope: i === 0 ? 'row' : undefined }, zelle)),
      ))),
    ),
  );
}

// Zahlenfeld mit Komma. beiAenderung(wert): Zahl, null (leer) oder NaN (unlesbar).
function zahlFeld(wert, beiAenderung, beschriftung) {
  const eingabe = el('input', { type: 'text', inputmode: 'decimal', 'aria-label': beschriftung, value: zahlZuText(wert) });
  eingabe.addEventListener('input', () => beiAenderung(parseDezimal(eingabe.value)));
  return eingabe;
}

function auswahl(optionen, wert, beiAenderung, beschriftung) {
  const feld = el('select', { 'aria-label': beschriftung }, optionen.map((o) => el('option', { value: o.wert }, o.label)));
  feld.value = wert;
  feld.addEventListener('change', () => beiAenderung(feld.value));
  return feld;
}

const entfernenKnopf = (beiKlick, text = 'Entfernen') => el('button', { type: 'button', class: 'klein gefahr', onClick: beiKlick }, text);

// --- Liste und Vergleich -------------------------------------------------------------------------

function abweichungenListe(ist, szenario) {
  const zeilen = beschreibeAbweichungen(ist, szenario);
  if (zeilen.length === 0) return el('p', { class: 'zeile' }, 'Noch keine Abweichungen: Das Szenario entspricht dem Ist-Zustand.');
  return tabelle({
    kopf: ['Bereich', 'Ziel', 'Ist-Zustand', 'Szenario'],
    zeilen: zeilen.map((z) => [z.bereich, z.hinweis ? `${z.ziel} ⚠` : z.ziel, z.ist, z.szenario]),
  });
}

function szenarioKarte(ist, szenario, aktiv, neuLaden) {
  const anzahl = zaehleAbweichungen(szenario);
  const { hinweise } = wendeSzenarioAn(ist, szenario);
  const istAktiv = aktiv?.id === szenario.id;

  return el(
    'li', { class: `karte szenariokarte${istAktiv ? ' aktiv' : ''}` },
    el('h3', {}, szenario.name, istAktiv ? el('span', { class: 'marke' }, 'aktiv') : null),
    szenario.beschreibung ? el('p', { class: 'zeile' }, szenario.beschreibung) : null,
    el('p', { class: 'zeile' }, `${anzahl} Abweichung${anzahl === 1 ? '' : 'en'} gegenüber dem Ist-Zustand${hinweise.length > 0 ? `, ⚠ ${hinweise.length} ohne Ziel im Ist-Zustand` : ''}`),
    kostenNachFoerderung(szenario.kosten)
      ? el('p', { class: 'zeile' }, `Kosten nach Förderung: ${bandText(kostenNachFoerderung(szenario.kosten), 0, '€')}${szenario.kosten.quelle ? ` (${szenario.kosten.quelle})` : ''}`)
      : null,
    el('details', {}, el('summary', {}, 'Abweichungen anzeigen'), abweichungenListe(ist, szenario)),
    el(
      'div', { class: 'knopfzeile' },
      el('button', { type: 'button', class: istAktiv ? '' : 'primaer', onClick: () => setzeAktivesSzenario(istAktiv ? null : szenario.id) }, istAktiv ? 'Zum Ist-Zustand' : 'Aktivieren'),
      el('a', { class: 'knopf', href: `#szenarien/${szenario.id}` }, 'Bearbeiten'),
      el('button', {
        type: 'button',
        onClick: async () => {
          const name = prompt('Name der Kopie:', `${szenario.name} (Kopie)`);
          if (name === null || name.trim() === '') return;
          await db.speichere('scenarios', kopiereSzenario(szenario, db.neueId, name.trim()));
          neuLaden();
        },
      }, 'Kopieren'),
      el('button', {
        type: 'button',
        onClick: async () => {
          const name = prompt('Neuer Name:', szenario.name);
          if (name === null || name.trim() === '') return;
          await db.speichere('scenarios', { ...szenario, name: name.trim() });
          neuLaden();
        },
      }, 'Umbenennen'),
      el('button', {
        type: 'button',
        class: 'gefahr',
        onClick: async () => {
          if (!confirm(`Szenario „${szenario.name}“ löschen? Der Ist-Zustand bleibt unverändert.`)) return;
          if (istAktiv) await setzeAktivesSzenario(null);
          await db.loesche('scenarios', szenario.id);
          neuLaden();
        },
      }, 'Löschen'),
    ),
  );
}

// Annahmen für die Jahreswärme-Differenz: Gradtagzahl, Jahresarbeitszahl, Strompreis. Sie gehören nicht zu den Bestandsdaten
// und bleiben deshalb auch bei aktivem Szenario bearbeitbar.
function annahmenKarte(ist, neuLaden) {
  const a = vergleichsannahmen(ist.einstellungen);
  const thetaMittel = mittlereInnentemperatur(ist.raeume);
  const g = loeseGradtageAuf(ist.verbrauch, a, thetaMittel);
  const entwurf = JSON.parse(JSON.stringify(a));
  const meldung = el('p', { class: 'zeile', 'aria-live': 'polite' });
  const manuellZeile = el('div', { class: 'knopfzeile' }, el('span', {}, 'Gradtagzahl G: '), zahlFeld(entwurf.gradtage.manuell, (w) => { entwurf.gradtage.manuell = w; }, 'Gradtagzahl G manuell'), ' Kd');
  const verbrauchZeile = el('div', { class: 'knopfzeile' }, el('span', {}, 'Verbrauchsdatensatz: '), auswahl(
    [{ wert: '', label: ist.verbrauch.length > 0 ? '– bitte wählen –' : 'kein Verbrauchsabgleich vorhanden' }, ...ist.verbrauch.map((v) => ({ wert: v.id, label: v.name }))],
    entwurf.gradtage.verbrauchId ?? '', (w) => { entwurf.gradtage.verbrauchId = w || null; }, 'Verbrauchsdatensatz für G',
  ));
  const zeigeQuelle = () => { manuellZeile.hidden = entwurf.gradtage.quelle !== 'manuell'; verbrauchZeile.hidden = entwurf.gradtage.quelle === 'manuell'; };
  const quelleWahl = auswahl(
    [{ wert: 'verbrauch', label: 'Aus Verbrauchsdatensatz (Summe der Heizmonate, umgerechnet auf die mittlere Soll-Temperatur)' }, { wert: 'manuell', label: 'Manuell eingeben' }],
    entwurf.gradtage.quelle, (w) => { entwurf.gradtage.quelle = w; zeigeQuelle(); }, 'Quelle der Gradtagzahl',
  );
  zeigeQuelle();
  const bereichZeile = (name, objekt, einheit, beschriftung) => el(
    'div', { class: 'knopfzeile' }, el('span', {}, `${name}: min `), zahlFeld(objekt.min, (w) => { objekt.min = w; }, `${beschriftung} min`),
    el('span', {}, ' max '), zahlFeld(objekt.max, (w) => { objekt.max = w; }, `${beschriftung} max`), ` ${einheit}`,
  );
  const speichern = el('button', {
    type: 'button',
    class: 'primaer',
    'data-lesen': true,
    onClick: async () => {
      const fehler = [];
      const bereichPruefen = (name, b) => {
        const leer = (x) => x === null || x === undefined;
        if (leer(b.min) && leer(b.max)) return { min: null, max: null };
        if (!(Number.isFinite(b.min) && Number.isFinite(b.max)) || b.min < 0 || b.min > b.max) fehler.push(`${name}: bitte Minimum und Maximum als Zahlen eintragen (Minimum nicht größer als Maximum, nicht negativ).`);
        return b;
      };
      if (entwurf.gradtage.quelle === 'manuell' && entwurf.gradtage.manuell !== null && !(entwurf.gradtage.manuell > 0)) fehler.push('Gradtagzahl G: bitte eine Zahl größer als 0 eintragen.');
      const jaz = bereichPruefen('Jahresarbeitszahl', entwurf.jaz);
      if (jaz.min !== null && !(jaz.min > 0)) fehler.push('Jahresarbeitszahl: muss größer als 0 sein.');
      const preis = bereichPruefen('Strompreis', entwurf.strompreis);
      if (fehler.length > 0) { meldung.textContent = fehler.join(' '); return; }
      await db.speichereVergleichsannahmen({ gradtage: entwurf.gradtage, jaz, strompreis: preis });
      neuLaden();
    },
  }, 'Annahmen speichern');
  return el(
    'section', { class: 'karte', 'data-lesen': true },
    el('h3', {}, 'Annahmen für die Jahreswärme-Differenz'),
    el('p', { class: 'zeile' }, 'Die App schätzt nichts selbst: Gradtagzahl, Jahresarbeitszahl und Strompreis trägst du ein. JAZ und Strompreis sind optional, ohne sie entfällt die Stromrechnung.'),
    el('p', { class: 'zeile' }, `Mittlere Soll-Temperatur aus den Räumen: ${thetaMittel === null ? 'nicht berechenbar' : `${zahlZuText(Math.round(thetaMittel * 10) / 10)} °C`}. Aktuell: ${g.text}.`),
    el('label', {}, el('span', { class: 'klein' }, 'Gradtagzahl G aus'), quelleWahl),
    verbrauchZeile,
    manuellZeile,
    bereichZeile('Jahresarbeitszahl JAZ', entwurf.jaz, '', 'JAZ'),
    bereichZeile('Strompreis', entwurf.strompreis, 'ct/kWh', 'Strompreis'),
    el('div', { class: 'knopfzeile' }, speichern),
    meldung,
  );
}

function vergleichsAnsicht(ist, szenarien) {
  if (szenarien.length === 0) return el('p', { class: 'leer' }, 'Sobald es Szenarien gibt, steht hier der Vergleich mit dem Ist-Zustand.');
  const vergleich = baueVergleich(ist, szenarien);
  const t = vergleichTabellen(vergleich);
  const hinweise = vergleich.spalten.filter((s) => s.szenarioHinweise.length > 0);
  return el(
    'div', {},
    el('h3', {}, 'Kennzahlen'),
    tabelle(t.kennzahlen),
    hinweise.length > 0
      ? el('div', { class: 'meldung warnung' }, el('strong', {}, 'Hinweise zu Abweichungen'), el('ul', {}, hinweise.flatMap((s) => s.szenarioHinweise.map((h) => el('li', {}, `${s.name}: ${h.text}`)))))
      : null,
    el('h3', {}, 'Jahreswärme-Differenz gegenüber dem Ist-Zustand'),
    el('p', { class: 'meldung warnung jahreshinweis' }, el('strong', {}, 'Hinweis: '), t.jahreswaerme.hinweis),
    tabelle(t.jahreswaerme),
    el('ul', { class: 'zeile' }, t.jahreswaerme.annahmen.map((x) => el('li', {}, x))),
    el('h3', {}, 'Räume'),
    el('p', { class: 'zeile' }, 'Heizlast als Mittelwert; die Vorlauftemperatur gilt für die ungünstige Heizlast.'),
    tabelle(t.raeume),
    el('h3', {}, 'Woher kommt die Änderung? Verluste nach Art'),
    el('p', { class: 'zeile' }, 'Mittelwert aus günstiger und ungünstiger Rechnung. Raum-zu-Raum-Ströme bleiben im Haus und sind nicht enthalten, die Summe entspricht der Gebäudeheizlast.'),
    tabelle(t.transmission),
  );
}

async function renderListe(container, neuLaden) {
  const [ist, szenarien, aktiv] = await Promise.all([ladeIstProjekt(), ladeSzenarien(), ladeAktivesSzenario()]);
  const neu = el('button', {
    type: 'button',
    class: 'primaer',
    onClick: async () => {
      const s = neuesSzenario(db.neueId());
      await db.speichere('scenarios', s);
      location.hash = `#szenarien/${s.id}`;
    },
  }, '+ Szenario');

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Szenarien'), neu),
    el(
      'p', { class: 'beschreibung' },
      'Ein Szenario beschreibt Abweichungen gegenüber dem Ist-Zustand, zum Beispiel ein gedämmtes Dach oder zusätzliche Heizkörper. '
      + 'Der Ist-Zustand wird dadurch nie verändert. Mit „Aktivieren“ zeigen Räume, Plan, Vorlauf und Bericht die Werte des Szenarios. '
      + 'Kopieren hilft, Kombinationen aufzubauen.',
    ),
    el(
      'ul', { class: 'szenarioliste' },
      el(
        'li', { class: `karte szenariokarte${aktiv ? '' : ' aktiv'}` },
        el('h3', {}, 'Ist-Zustand', aktiv ? null : el('span', { class: 'marke' }, 'aktiv')),
        el('p', { class: 'zeile' }, 'Die Bestandsdaten, so wie sie unter Räume, Bauteile und Heizkörper stehen.'),
        aktiv ? el('div', { class: 'knopfzeile' }, el('button', { type: 'button', onClick: () => setzeAktivesSzenario(null) }, 'Zum Ist-Zustand')) : null,
      ),
      ...szenarien.map((s) => szenarioKarte(ist, s, aktiv, neuLaden)),
    ),
    el('h2', {}, 'Vergleich'),
    annahmenKarte(ist, neuLaden),
    vergleichsAnsicht(ist, szenarien),
  );
}

// --- Editor ------------------------------------------------------------------------------------

function bearbeiteNeuenHeizkoerper(ist, entwurf, heizkoerper, nachSpeichern) {
  const raum = ist.raeume.find((r) => r.id === heizkoerper.raumId);
  oeffneDialog({
    titel: `Szenario-Heizkörper in „${raum?.name ?? '?'}“`,
    felder: heizkoerperFelder(),
    werteVorgabe: { ...heizkoerper, kennlinieText: kennlinieZuText(heizkoerper.kennlinie), normWahl: normWahlVon(heizkoerper) },
    validiere: (gelesen) => validiereHeizkoerper(gelesen, OPTIONEN),
    ausnahmeSchutz: true,
    speichern: async (gelesen) => {
      const { kennlinieText, normWahl, ...rest } = gelesen;
      const neu = {
        ...rest, raumId: heizkoerper.raumId, kennlinie: parseKennlinie(kennlinieText).paare, id: rest.id ?? db.neueId(),
        name: `${label(BAUARTEN_HK, rest.bauart)} in „${raum?.name ?? '?'}“`,
      };
      const liste = entwurf.abweichungen.neueHeizkoerper;
      const index = liste.findIndex((h) => h.id === neu.id);
      if (index >= 0) liste[index] = neu; else liste.push(neu);
      nachSpeichern();
    },
  });
}

async function renderEditor(container, id) {
  const [ist, alle] = await Promise.all([ladeIstProjekt(), ladeSzenarien()]);
  const vorhanden = alle.find((s) => s.id === id);
  if (!vorhanden) {
    ersetzeKinder(container, el('p', { class: 'leer' }, 'Dieses Szenario gibt es nicht mehr.'), el('a', { class: 'knopf', href: '#szenarien' }, 'Zur Liste'));
    return;
  }
  const entwurf = kopie(normalisiereSzenario(vorhanden));
  const a = entwurf.abweichungen;
  const meldungsBereich = el('div', { class: 'meldungen', 'aria-live': 'polite' });
  const bereiche = el('div', {});
  let bestaetigt = false;
  const geaendert = () => { bestaetigt = false; speichernKnopf.textContent = 'Speichern'; };

  const nameVon = (liste, id2) => liste.find((x) => x.id === id2)?.name ?? null;
  const raumName = (id2) => nameVon(ist.raeume, id2);
  const fehlt = 'gibt es nicht mehr';

  // Auswahl „Eintrag hinzufügen“ für Abschnitte mit einer Zeile je Ziel.
  function hinzufuegen(kandidaten, beschriftung, anlegen) {
    if (kandidaten.length === 0) return el('p', { class: 'zeile' }, 'Alle möglichen Einträge sind schon aufgeführt.');
    let gewaehlt = kandidaten[0].wert;
    const wahl = auswahl(kandidaten, gewaehlt, (w) => { gewaehlt = w; }, beschriftung);
    return el('div', { class: 'knopfzeile' }, wahl, el('button', { type: 'button', onClick: () => { anlegen(gewaehlt); geaendert(); zeichne(); } }, '+ Hinzufügen'));
  }

  const abschnitt = (titel, text, ...inhalt) => el('section', { class: 'karte szenario-abschnitt' }, el('h3', {}, titel), text ? el('p', { class: 'zeile' }, text) : null, ...inhalt);
  const feldMitFehlerFlag = (wert, beiAenderung, beschriftung) => zahlFeld(wert, (w) => { beiAenderung(w); geaendert(); }, beschriftung);
  const zeileMitHinweis = (zeile, ziel) => (ziel === null ? [zeile] : [zeile, el('tr', {}, el('td', { class: 'hinweis-zeile', colspan: '4' }, `⚠ ${ziel} ${fehlt} im Ist-Zustand, die Abweichung wirkt nicht.`))]);

  // Kosten: reine Eingabe, die App schätzt nichts.
  function kostenAbschnitt() {
    const k = entwurf.kosten;
    const zeile = (name, bereich, beschriftung) => el(
      'div', { class: 'knopfzeile' }, el('span', {}, `${name}: min `), feldMitFehlerFlag(bereich.min, (w) => { bereich.min = w; }, `${beschriftung} min`),
      el('span', {}, ' max '), feldMitFehlerFlag(bereich.max, (w) => { bereich.max = w; }, `${beschriftung} max`), ' €',
    );
    const quelle = el('input', { type: 'text', value: k.quelle, 'aria-label': 'Quelle der Kosten' });
    quelle.addEventListener('input', () => { k.quelle = quelle.value; geaendert(); });
    return abschnitt(
      'Kosten (Eingabe)', 'Die App schätzt keine Kosten. Trage Minimum und Maximum aus Angeboten ein, leer lassen heißt „nicht angegeben“. Ohne Förderung gilt 0 €. Kosten nach Förderung = Investition minus Förderung, von der niedrigsten Investition mit höchster Förderung bis zur höchsten Investition mit niedrigster Förderung.',
      zeile('Investitionskosten', k.investition, 'Investition'),
      zeile('Förderung', k.foerderung, 'Förderung'),
      el('label', {}, el('span', { class: 'klein' }, 'Quelle (zum Beispiel „Angebot Dachdecker vom …“)'), quelle),
    );
  }

  function bauteileAbschnitt() {
    const zeilen = Object.entries(a.bauteile).flatMap(([bid, ov]) => {
      const b = ist.bauteile.find((x) => x.id === bid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, b?.name ?? ov.name ?? bid),
        el('td', { class: 'ist' }, b ? `${bereichText(b.u)} W/(m²K)` : '–'),
        el('td', {}, 'min ', feldMitFehlerFlag(ov.u?.min, (w) => { ov.u = { ...ov.u, min: w }; }, `U min ${ov.name}`), ' max ', feldMitFehlerFlag(ov.u?.max, (w) => { ov.u = { ...ov.u, max: w }; }, `U max ${ov.name}`)),
        el('td', {}, entfernenKnopf(() => { delete a.bauteile[bid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, b ? null : `Das Bauteil „${ov.name ?? bid}“`);
    });
    const frei = ist.bauteile.filter((b) => !a.bauteile[b.id]).map((b) => ({ wert: b.id, label: `${b.name} (Ist ${bereichText(b.u)})` }));
    return abschnitt(
      'Bauteile: U-Wert-Spanne', 'Überschreibt den U-Wert eines Bauteils aus dem Katalog in allen Flächen, die es nutzen. Bei sicherem Wert min und max gleich eintragen.',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Bauteil', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Bauteil hinzufügen', (bid) => { const b = ist.bauteile.find((x) => x.id === bid); a.bauteile[bid] = { name: b.name, u: { min: b.u.min, max: b.u.max } }; }),
    );
  }

  function oeffnungenAbschnitt() {
    const zeilen = Object.entries(a.oeffnungstypen).flatMap(([tid, ov]) => {
      const t = ist.oeffnungstypen.find((x) => x.id === tid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, t?.name ?? ov.name ?? tid),
        el('td', { class: 'ist' }, t ? `${zahlZuText(t.uw)} W/(m²K)` : '–'),
        el('td', {}, feldMitFehlerFlag(ov.uw, (w) => { ov.uw = w; }, `Uw ${ov.name}`), ' W/(m²K)'),
        el('td', {}, entfernenKnopf(() => { delete a.oeffnungstypen[tid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, t ? null : `Der Öffnungstyp „${ov.name ?? tid}“`);
    });
    const frei = ist.oeffnungstypen.filter((t) => !a.oeffnungstypen[t.id]).map((t) => ({ wert: t.id, label: `${t.name} (Ist ${zahlZuText(t.uw)})` }));
    return abschnitt(
      'Fenster und Türen: Uw', 'Überschreibt den Uw-Wert eines Öffnungstyps in allen Flächen, die ihn nutzen.',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Öffnungstyp', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Öffnungstyp hinzufügen', (tid) => { const t = ist.oeffnungstypen.find((x) => x.id === tid); a.oeffnungstypen[tid] = { name: t.name, uw: t.uw }; }),
    );
  }

  const hkTitel = (h) => `${raumName(h.raumId) ?? '?'}: ${label(BAUARTEN_HK, h.bauart)}${h.bauart === 'platten' && h.typ ? ` ${h.typ}` : ''}${h.normleistung ? `, ${zahlZuText(h.normleistung)} W` : ''}`;

  function heizkoerperAbschnitt() {
    const statusOpt = HK_STATI.map((s) => ({ wert: s.wert, label: s.label }));
    const zeilen = Object.entries(a.heizkoerperStatus).flatMap(([hid, ov]) => {
      const h = ist.heizkoerper.find((x) => x.id === hid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, h ? hkTitel(h) : (ov.name ?? hid)),
        el('td', { class: 'ist' }, h ? label(HK_STATI, h.status) : '–'),
        el('td', {}, auswahl(statusOpt, ov.status, (w) => { ov.status = w; geaendert(); }, `Status ${ov.name ?? hid}`)),
        el('td', {}, entfernenKnopf(() => { delete a.heizkoerperStatus[hid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, h ? null : `Der Heizkörper „${ov.name ?? hid}“`);
    });
    const frei = ist.heizkoerper.filter((h) => !a.heizkoerperStatus[h.id]).map((h) => ({ wert: h.id, label: `${hkTitel(h)} (${label(HK_STATI, h.status)})` }));

    const neueZeilen = a.neueHeizkoerper.flatMap((h) => {
      const raumOk = Boolean(raumName(h.raumId));
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, `${raumName(h.raumId) ?? h.name ?? '?'}: ${label(BAUARTEN_HK, h.bauart)}`),
        el('td', { class: 'ist' }, 'nicht vorhanden'),
        el('td', {}, `${label(HK_STATI, h.status)}, ${h.bauart === 'wp' ? `Kennlinie (${(h.kennlinie ?? []).length} Wertepaare)` : h.normleistung ? `${zahlZuText(h.normleistung)} W bei ${zahlZuText(h.normVorlauf)}/${zahlZuText(h.normRuecklauf)}/${zahlZuText(h.normRaum)}` : 'Leistung fehlt'} `,
          el('button', { type: 'button', class: 'klein', onClick: () => bearbeiteNeuenHeizkoerper(ist, entwurf, h, () => { geaendert(); zeichne(); }) }, 'Bearbeiten')),
        el('td', {}, entfernenKnopf(() => { a.neueHeizkoerper = a.neueHeizkoerper.filter((x) => x.id !== h.id); geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, raumOk ? null : `Der Raum „${h.name ?? h.raumId}“`);
    });
    const raumOpt = ist.raeume.filter((r) => r.status === 'beheizt').map((r) => ({ wert: r.id, label: r.name }));
    let neuerRaum = raumOpt[0]?.wert;
    const neuWahl = auswahl(raumOpt, neuerRaum, (w) => { neuerRaum = w; }, 'Raum für neuen Heizkörper');

    return abschnitt(
      'Heizkörper', 'Status eines vorhandenen Heizkörpers ändern (zum Beispiel „Bleibt“ zu „Entfällt“) und Heizkörper anlegen, die nur in diesem Szenario existieren.',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Heizkörper', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Heizkörper für Statusänderung', (hid) => { const h = ist.heizkoerper.find((x) => x.id === hid); a.heizkoerperStatus[hid] = { name: hkTitel(h), status: h.status }; }),
      el('h4', {}, 'Heizkörper nur in diesem Szenario'),
      neueZeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Raum und Bauart', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, neueZeilen))) : el('p', { class: 'zeile' }, 'Noch keine szenario-eigenen Heizkörper.'),
      raumOpt.length > 0
        ? el('div', { class: 'knopfzeile' }, neuWahl, el('button', {
          type: 'button',
          onClick: () => bearbeiteNeuenHeizkoerper(ist, entwurf, { ...neuerHeizkoerper(neuerRaum), status: 'neu' }, () => { geaendert(); zeichne(); }),
        }, '+ Neuer Heizkörper'))
        : el('p', { class: 'zeile' }, 'Es gibt keinen beheizten Raum.'),
    );
  }

  function raumAbschnitt() {
    const zeilen = Object.entries(a.raumTemperatur).flatMap(([rid, ov]) => {
      const r = ist.raeume.find((x) => x.id === rid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, r?.name ?? ov.name ?? rid),
        el('td', { class: 'ist' }, r ? `${zahlZuText(r.theta)} °C` : '–'),
        el('td', {}, feldMitFehlerFlag(ov.theta, (w) => { ov.theta = w; }, `Soll-Temperatur ${ov.name}`), ' °C'),
        el('td', {}, entfernenKnopf(() => { delete a.raumTemperatur[rid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, r ? null : `Der Raum „${ov.name ?? rid}“`);
    });
    const frei = ist.raeume.filter((r) => !a.raumTemperatur[r.id] && r.status !== 'unbeheizt').map((r) => ({ wert: r.id, label: `${r.name} (Ist ${zahlZuText(r.theta)} °C)` }));
    return abschnitt(
      'Räume: Soll-Temperatur', 'Überschreibt die Soll-Temperatur eines Raums (bei passiven Räumen die angenommene Temperatur).',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Raum', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Raum hinzufügen', (rid) => { const r = ist.raeume.find((x) => x.id === rid); a.raumTemperatur[rid] = { name: r.name, theta: r.theta }; }),
    );
  }

  function luftwechselAbschnitt() {
    const istStandard = ist.einstellungen.luftwechselStandard;
    const standard = a.luftwechselStandard
      ? el(
        'div', { class: 'knopfzeile' },
        el('span', {}, 'Standard-Luftwechsel: min '), feldMitFehlerFlag(a.luftwechselStandard.min, (w) => { a.luftwechselStandard.min = w; }, 'Standard-Luftwechsel min'),
        el('span', {}, ' max '), feldMitFehlerFlag(a.luftwechselStandard.max, (w) => { a.luftwechselStandard.max = w; }, 'Standard-Luftwechsel max'), ' 1/h',
        entfernenKnopf(() => { a.luftwechselStandard = null; geaendert(); zeichne(); }),
      )
      : el('div', { class: 'knopfzeile' }, el('button', { type: 'button', onClick: () => { a.luftwechselStandard = { min: istStandard.min, max: istStandard.max }; geaendert(); zeichne(); } }, 'Standard-Luftwechsel überschreiben'));

    const zeilen = Object.entries(a.luftwechselRaum).flatMap(([rid, ov]) => {
      const r = ist.raeume.find((x) => x.id === rid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, r?.name ?? ov.name ?? rid),
        el('td', { class: 'ist' }, r ? (r.luftwechsel ? `${bereichText(r.luftwechsel)} 1/h` : `Standard ${bereichText(istStandard)} 1/h`) : '–'),
        el('td', {}, 'min ', feldMitFehlerFlag(ov.min, (w) => { ov.min = w; }, `Luftwechsel min ${ov.name}`), ' max ', feldMitFehlerFlag(ov.max, (w) => { ov.max = w; }, `Luftwechsel max ${ov.name}`)),
        el('td', {}, entfernenKnopf(() => { delete a.luftwechselRaum[rid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, r ? null : `Der Raum „${ov.name ?? rid}“`);
    });
    const frei = ist.raeume.filter((r) => !a.luftwechselRaum[r.id] && r.status !== 'unbeheizt').map((r) => ({ wert: r.id, label: r.name }));
    return abschnitt(
      'Luftwechsel', `Ist-Zustand: Standard ${bereichText(istStandard)} 1/h. Ein Wert für einen Raum geht dem Standard vor.`,
      standard,
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Raum', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Raum für Luftwechsel hinzufügen', (rid) => {
        const r = ist.raeume.find((x) => x.id === rid);
        const basis = r.luftwechsel ?? istStandard;
        a.luftwechselRaum[rid] = { name: r.name, min: basis.min, max: basis.max };
      }),
    );
  }

  function einstellungenAbschnitt() {
    const zeile = (schluessel, name, istText, einheit, anfang) => {
      const an = a.einstellungen[schluessel] !== undefined;
      return el(
        'div', { class: 'knopfzeile' },
        el('span', {}, `${name} (Ist ${istText}): `),
        an
          ? [feldMitFehlerFlag(a.einstellungen[schluessel], (w) => { a.einstellungen[schluessel] = w; }, name), ` ${einheit} `, entfernenKnopf(() => { delete a.einstellungen[schluessel]; geaendert(); zeichne(); })]
          : el('button', { type: 'button', onClick: () => { a.einstellungen[schluessel] = anfang; geaendert(); zeichne(); } }, 'Überschreiben'),
      );
    };
    return abschnitt(
      'Einstellungen', null,
      zeile('zielVorlauf', 'Ziel-Vorlauftemperatur', `${zahlZuText(ist.einstellungen.zielVorlauf ?? 45)} °C`, '°C', ist.einstellungen.zielVorlauf ?? 45),
      zeile('spreizung', 'Spreizung', `${zahlZuText(ist.einstellungen.spreizung)} K`, 'K', ist.einstellungen.spreizung),
    );
  }

  function zeichne() {
    ersetzeKinder(bereiche, kostenAbschnitt(), bauteileAbschnitt(), oeffnungenAbschnitt(), heizkoerperAbschnitt(), raumAbschnitt(), luftwechselAbschnitt(), einstellungenAbschnitt());
  }

  const speichernKnopf = el('button', { type: 'button', class: 'primaer' }, 'Speichern');
  speichernKnopf.addEventListener('click', async () => {
    const meldungen = validiereSzenario(entwurf);
    ersetzeKinder(meldungsBereich, meldungen.map((m) => el('p', { class: `meldung ${m.stufe === 'fehler' ? 'fehler' : 'warnung'}` }, `${m.stufe === 'fehler' ? '✗' : '⚠'} ${m.text}`)));
    if (hatFehler(meldungen)) return;
    if (hatWarnungen(meldungen) && !bestaetigt) {
      bestaetigt = true;
      speichernKnopf.textContent = 'Trotzdem speichern';
      return;
    }
    await db.speichere('scenarios', entwurf);
    location.hash = '#szenarien';
  });

  const name = el('input', { type: 'text', value: entwurf.name, 'aria-label': 'Name des Szenarios' });
  name.addEventListener('input', () => { entwurf.name = name.value; geaendert(); });
  const beschreibung = el('textarea', { rows: 3, 'aria-label': 'Beschreibung' });
  beschreibung.value = entwurf.beschreibung;
  beschreibung.addEventListener('input', () => { entwurf.beschreibung = beschreibung.value; geaendert(); });

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Szenario bearbeiten'), el('a', { class: 'knopf', href: '#szenarien' }, 'Zurück zur Liste')),
    el('p', { class: 'beschreibung' }, 'Links steht jeweils der Ist-Wert, rechts der Wert im Szenario. Der Ist-Zustand wird hier nie geändert.'),
    el('section', { class: 'karte' }, el('label', {}, el('span', { class: 'klein' }, 'Name'), name), el('label', {}, el('span', { class: 'klein' }, 'Beschreibung'), beschreibung)),
    bereiche,
    meldungsBereich,
    el('div', { class: 'knopfzeile' }, speichernKnopf, el('a', { class: 'knopf', href: '#szenarien' }, 'Abbrechen')),
  );
  zeichne();
}

export async function renderSzenarien(container, id, neuLaden) {
  if (id) await renderEditor(container, id);
  else await renderListe(container, neuLaden);
}
