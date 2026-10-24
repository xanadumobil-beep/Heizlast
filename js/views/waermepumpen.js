// Wärmepumpen-Katalog: Geräte mit BAFA-Angaben und Leistungspunkten aus dem Datenblatt. Der Katalog gehört nicht zum Haus:
// Er lässt sich auch im Szenario-Betrieb bearbeiten und als eigene Datei tauschen.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { oeffneDialog } from '../dialog.js';
import { formatZahl, zahlZuText } from '../engine/format.js';
import { hatFehler, hatWarnungen, validiereWaermepumpe } from '../validate.js';
import { WAERMEPUMPEN_FELDER, neueWaermepumpe, normalisiereWaermepumpe, BAFA_STATI } from '../schemas.js';
import { baueKatalogExport, pruefeKatalogImport, katalogDateiname, datumText } from '../io.js';
import { geraetName, fehlendeWerte, BAFA_HINWEIS } from '../geraete.js';
import { gibDateiAus } from './sicherung.js';

const zeitText = (x) => (x === null || x === undefined ? '–' : zahlZuText(x));
const bandText = (b) => (b.min === b.max ? zahlZuText(b.min) : `${zahlZuText(b.min)} – ${zahlZuText(b.max)}`);
const istLink = (t) => /^https?:\/\//i.test((t ?? '').trim());

function punkteTabelle(g) {
  const punkte = [...g.punkte].sort((a, b) => (a.aussen - b.aussen) || (a.vorlauf - b.vorlauf));
  if (punkte.length === 0) return el('p', { class: 'zeile' }, 'Keine Leistungspunkte erfasst.');
  return el(
    'div', { class: 'tabellenrahmen' },
    el(
      'table', { class: 'tabelle punkte' },
      el('thead', {}, el('tr', {}, ['Außen °C', 'Vorlauf °C', 'Max. kW', 'Min. kW', 'COP'].map((k) => el('th', { scope: 'col', class: 'zahl' }, k)))),
      el('tbody', {}, punkte.map((p) => el('tr', {}, [p.aussen, p.vorlauf, p.max, p.min, p.cop].map((w) => el('td', { class: 'zahl' }, zeitText(w)))))),
    ),
  );
}

function karte(g, { bearbeiten, kopieren, loeschen }) {
  const meldungen = validiereWaermepumpe(g);
  const markiert = hatFehler(meldungen) || hatWarnungen(meldungen);
  const b = g.bafa;
  const foerder = BAFA_STATI.find((s) => s.wert === b.foerderfaehig)?.label ?? 'unbekannt';
  const bafa = [
    `Förderfähig: ${foerder}`,
    b.nennleistung55 !== null && b.nennleistung55 !== undefined ? `Nennleistung 55 °C: ${zahlZuText(b.nennleistung55)} kW` : null,
    b.eta35 !== null && b.eta35 !== undefined ? `ETAs 35 °C: ${zahlZuText(b.eta35)} %` : null,
    b.eta55 !== null && b.eta55 !== undefined ? `ETAs 55 °C: ${zahlZuText(b.eta55)} %` : null,
    b.kaeltemittel ? `Kältemittel: ${b.kaeltemittel}` : null,
    b.stand ? `Stand: ${datumText(b.stand)}` : null,
  ].filter(Boolean).join(' · ');
  const fehlend = g.punkte.length > 0 ? fehlendeWerte(g) : [];
  return el(
    'article', { class: markiert ? 'karte markiert geraet-karte' : 'karte geraet-karte', 'data-geraet': geraetName(g) },
    el('h3', {}, geraetName(g), markiert ? el('span', { class: 'marke' }, '⚠ prüfen') : null),
    g.typ ? el('p', { class: 'zeile' }, `Typ: ${g.typ}`) : null,
    g.anbieter ? el('p', { class: 'zeile' }, `Anbieter / Angebot: ${g.anbieter}`) : null,
    g.preis ? el('p', { class: 'zeile' }, `Preis: ${bandText(g.preis)} €`) : null,
    g.datenblatt
      ? el('p', { class: 'zeile' }, 'Datenblatt: ', istLink(g.datenblatt) ? el('a', { href: g.datenblatt.trim(), target: '_blank', rel: 'noopener noreferrer' }, g.datenblatt) : g.datenblatt)
      : null,
    el('p', { class: 'zeile' }, `BAFA: ${bafa}`),
    punkteTabelle(g),
    g.schall !== null && g.schall !== undefined ? el('p', { class: 'zeile' }, `Schallleistungspegel Außengerät: ${formatZahl(g.schall, 0)} dB(A)`) : null,
    g.notiz ? el('p', { class: 'zeile notiz' }, g.notiz) : null,
    fehlend.length > 0 ? el('p', { class: 'meldung warnung' }, `Für die Prüfung fehlen: ${fehlend.join(', ')}.`) : null,
    meldungen.filter((m) => m.stufe === 'fehler' || m.feld !== 'punkte').map((m) => el('p', { class: `meldung ${m.stufe}` }, `⚠ ${m.text}`)),
    el(
      'div', { class: 'knopfzeile' },
      el('button', { type: 'button', onClick: bearbeiten }, 'Bearbeiten'),
      el('button', { type: 'button', onClick: kopieren }, 'Kopieren'),
      el('button', { type: 'button', class: 'gefahr loeschen', onClick: loeschen }, 'Löschen'),
    ),
  );
}

export async function renderWaermepumpen(container, neuLaden) {
  const geraete = (await db.alle('heatpumps')).map(normalisiereWaermepumpe).sort((a, b) => geraetName(a).localeCompare(geraetName(b), 'de'));
  const vorschau = el('div', { 'aria-live': 'polite' });
  const rueckmeldung = el('p', { class: 'ok', 'aria-live': 'polite' });

  const bearbeiten = (vorgabe) => oeffneDialog({
    titel: `Wärmepumpe ${vorgabe.id ? 'bearbeiten' : 'anlegen'}`,
    felder: WAERMEPUMPEN_FELDER,
    werteVorgabe: vorgabe,
    validiere: validiereWaermepumpe,
    ausnahmeSchutz: true,
    speichern: async (gelesen) => {
      await db.speichere('heatpumps', { ...normalisiereWaermepumpe(gelesen), id: gelesen.id ?? db.neueId() });
      neuLaden();
    },
  });

  const exportiere = async () => {
    const jetzt = new Date();
    const name = katalogDateiname(jetzt);
    const datei = new File([`${JSON.stringify(baueKatalogExport(geraete, jetzt), null, 2)}\n`], name, { type: 'application/json' });
    const ergebnis = await gibDateiAus(datei);
    rueckmeldung.textContent = ergebnis === 'geteilt' ? 'Katalog übergeben. Im Teilen-Menü „In Dateien sichern“ wählen.'
      : ergebnis === 'download' ? `Die Datei „${name}“ wurde heruntergeladen.` : '';
  };

  const uebernimm = async (pruefung, modus) => {
    if (modus === 'ersetzen' && geraete.length > 0 && !confirm(`Den Katalog ersetzen? Die ${geraete.length} Geräte in der App werden durch die ${pruefung.geraete.length} Geräte aus der Datei ersetzt. Hausdaten bleiben unverändert.`)) return;
    try {
      await db.uebernehmeKatalog(pruefung.geraete, modus);
    } catch (fehler) {
      ersetzeKinder(vorschau, el('p', { class: 'meldung fehler' }, `Der Import ist fehlgeschlagen, der Katalog ist unverändert: ${fehler.message}`));
      return;
    }
    neuLaden();
  };

  const zeigeVorschau = (pruefung, name) => {
    if (!pruefung.ok) {
      ersetzeKinder(vorschau, el('section', { class: 'karte markiert' }, el('h3', {}, 'Diese Datei lässt sich nicht importieren'), el('ul', {}, pruefung.fehler.map((f) => el('li', { class: 'meldung fehler' }, f))), el('p', { class: 'zeile' }, 'Es wurde nichts verändert.')));
      return;
    }
    ersetzeKinder(
      vorschau,
      el(
        'section', { class: 'karte' },
        el('h3', {}, `Katalogdatei „${name}“`),
        el('p', { class: 'zeile' }, `${pruefung.geraete.length} Geräte${pruefung.exportiertAm ? `, gesichert am ${datumText(pruefung.exportiertAm)}` : ''}. Jetzt im Katalog: ${geraete.length} Geräte. Hausdaten werden nicht berührt.`),
        pruefung.hinweise.length > 0 ? el('ul', {}, pruefung.hinweise.slice(0, 8).map((t) => el('li', { class: 'zeile' }, t))) : null,
        el(
          'div', { class: 'knopfzeile' },
          el('button', { type: 'button', class: 'primaer', onClick: () => uebernimm(pruefung, 'hinzufuegen') }, 'Zum Katalog hinzufügen'),
          el('button', { type: 'button', class: 'gefahr', onClick: () => uebernimm(pruefung, 'ersetzen') }, 'Katalog ersetzen'),
          el('button', { type: 'button', onClick: () => ersetzeKinder(vorschau) }, 'Abbrechen'),
        ),
        el('p', { class: 'hinweis' }, '„Hinzufügen“ überschreibt Geräte mit gleicher Kennung und lässt die übrigen stehen.'),
      ),
    );
  };

  const dateiwahl = el('input', {
    type: 'file', class: 'versteckt', 'aria-label': 'Katalogdatei wählen',
    onChange: async () => {
      const gewaehlt = dateiwahl.files[0];
      if (!gewaehlt) return;
      zeigeVorschau(pruefeKatalogImport(await gewaehlt.text()), gewaehlt.name);
      dateiwahl.value = '';
    },
  });

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Wärmepumpen'), el('button', { type: 'button', class: 'primaer', 'data-lesen': true, onClick: () => bearbeiten(neueWaermepumpe()) }, '+ Wärmepumpe')),
    el('p', { class: 'beschreibung' }, 'Katalog der Geräte, die zur Auswahl stehen, mit BAFA-Angaben und den Leistungspunkten aus dem Datenblatt. Die Prüfung gegen die Heizlast steht im Bereich Ergebnis.'),
    el('p', { class: 'meldung hinweis' }, BAFA_HINWEIS),
    geraete.length === 0
      ? el('p', { class: 'leer' }, 'Noch keine Wärmepumpen. Lege eine an oder importiere eine Katalogdatei.')
      : el('div', { class: 'karten' }, geraete.map((g) => karte(g, {
        bearbeiten: () => bearbeiten(g),
        kopieren: () => bearbeiten({ ...g, id: undefined, modell: `${g.modell} (Kopie)` }),
        loeschen: async () => {
          if (!confirm(`Wärmepumpe „${geraetName(g)}“ löschen?`)) return;
          await db.loesche('heatpumps', g.id);
          neuLaden();
        },
      }))),
    el(
      'section', { class: 'karte abstand', 'data-lesen': true },
      el('h3', {}, 'Katalog tauschen'),
      el('p', { class: 'zeile' }, 'Der Katalog steckt auch in der Sicherungsdatei. Als eigene Datei enthält er nur die Geräte und keine Hausdaten, so lässt er sich weitergeben und einlesen.'),
      el('div', { class: 'knopfzeile' }, el('button', { type: 'button', onClick: exportiere, disabled: geraete.length === 0 }, 'Katalog als Datei exportieren'), el('label', { class: 'knopf' }, 'Katalogdatei importieren …', dateiwahl)),
      rueckmeldung,
    ),
    vorschau,
  );
}
