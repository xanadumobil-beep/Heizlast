// Tests für Sicherungsdatei, Import-Prüfung, Beispieldatei und Sicherungsstatus.

import { test, gleich, wahr } from './runner.js';
import {
  baueExport, exportText, exportDateiname, pruefeImport, zusammenfassung, sicherungsStatus, bannerText,
  datumText, DATEI_SCHLUESSEL, SCHEMA_VERSION,
} from '../js/io.js';
import { baueRechenEingabe, baueHeizkoerperEingabe } from '../js/modell.js';
import { berechneGebaeude } from '../js/engine/heatload.js';
import { bewerteRaeume } from '../js/engine/vorlauf.js';
import { berechneVerbrauch } from '../js/engine/verbrauch.js';

// Beispieldatei laden: in Node aus dem Dateisystem, im Browser per fetch.
async function ladeBeispielText() {
  const adresse = new URL('../examples/beispiel-mini-haus.json', import.meta.url);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(adresse, 'utf8');
  }
  return (await fetch(adresse)).text();
}

const beispiel = async () => {
  const text = await ladeBeispielText();
  return { text, pruefung: pruefeImport(text), roh: JSON.parse(text) };
};

// --- Beispieldatei ------------------------------------------------------------------------

test('Beispieldatei: gültig, ohne Verweisfehler und ohne Inhaltshinweise', async () => {
  const { pruefung } = await beispiel();
  wahr(pruefung.ok, `Import muss gelingen: ${JSON.stringify(pruefung.fehler)}`);
  wahr(pruefung.verweise.length === 0, `keine Verweise ohne Ziel: ${JSON.stringify(pruefung.verweise)}`);
  wahr(pruefung.inhalt.length === 0, `keine Hinweise zu Inhalten: ${JSON.stringify(pruefung.inhalt)}`);
});

test('Beispieldatei: erfundenes Mini-Haus mit drei Räumen, alle Arten von Einträgen', async () => {
  const { pruefung } = await beispiel();
  const z = pruefung.zusammenfassung;
  wahr(z.raeume === 3 && z.raumflaechen === 14 && z.oeffnungen === 3 && z.heizkoerper === 4, `Mengen: ${JSON.stringify(z)}`);
  const stati = pruefung.daten.rooms.map((r) => r.status).sort().join();
  wahr(stati === 'beheizt,beheizt,passiv', 'zwei beheizte Räume und ein passiver Raum');
  const flur = pruefung.daten.rooms.find((r) => r.status === 'passiv');
  gleich(flur.waermeLieferanten.reduce((s, l) => s + l.prozent, 0), 100, 1e-9, 'Verteilung des passiven Raums ergibt 100 %');
  wahr(pruefung.daten.radiators.some((h) => h.bauart === 'wp') && pruefung.daten.radiators.some((h) => h.bauart === 'glieder'), 'Wärmepumpen- und Gliederheizkörper');
  wahr(pruefung.daten.radiators.every((h) => h.bauart === 'wp' || [h.normVorlauf, h.normRuecklauf, h.normRaum].every((x) => typeof x === 'number')), 'Normbedingungen überall angegeben');
});

// Die Beispieldatei ist ein vollständiges, rechenbares Projekt: die Gegenprobe stimmt, alle beheizten Räume
// haben eine Vorlauftemperatur, der Verbrauchsabgleich liefert ein Ergebnis.
test('Beispieldatei: rechnet durch (Gegenprobe ohne Differenz, Vorlauf je Raum, Verbrauch)', async () => {
  const { pruefung } = await beispiel();
  const d = pruefung.daten;
  const { eingabe, hinweise } = baueRechenEingabe({
    einstellungen: d.settings[0], zonen: d.zones, bauteile: d.components, oeffnungstypen: d.openingTypes, raeume: d.rooms, flaechen: d.surfaces,
  });
  wahr(hinweise.length === 0, `keine Modell-Hinweise: ${JSON.stringify(hinweise)}`);
  const ergebnis = berechneGebaeude(eingabe);
  wahr(ergebnis.warnungen.length === 0, `keine Warnungen: ${JSON.stringify(ergebnis.warnungen)}`);
  gleich(ergebnis.gebaeude.guenstig.differenz, 0, 0.001, 'Gegenprobe günstig');
  gleich(ergebnis.gebaeude.ungunstig.differenz, 0, 0.001, 'Gegenprobe ungünstig');
  wahr(ergebnis.gebaeude.guenstig.summe > 1000 && ergebnis.gebaeude.ungunstig.summe < 6000, 'Gebäudeheizlast im plausiblen Bereich');

  const bewertung = bewerteRaeume({
    raeume: ergebnis.raeume.filter((r) => r.status === 'beheizt'),
    heizkoerper: baueHeizkoerperEingabe(d.radiators, d.settings[0]),
    spreizung: d.settings[0].spreizung, zielVorlauf: d.settings[0].zielVorlauf,
  });
  wahr(bewertung.zeilen.every((z) => z.vorlauf.status === 'ok'), 'jeder beheizte Raum hat eine Vorlauftemperatur');
  wahr(bewertung.bestimmendId !== null, 'es gibt einen bestimmenden Raum');

  const verbrauch = berechneVerbrauch({ ...d.consumption[0], normAussentemperatur: d.settings[0].thetaAussen });
  wahr(verbrauch.status === 'ok', `Verbrauchsabgleich rechnet (${verbrauch.grund})`);
});

// --- Export und Import ----------------------------------------------------------------------

test('Export und Import: Rundlauf verändert nichts, alle IDs bleiben erhalten', async () => {
  const { pruefung } = await beispiel();
  const exportiert = baueExport(pruefung.daten, new Date('2026-10-24T12:00:00Z'));
  const zurueck = pruefeImport(exportText(exportiert));
  wahr(zurueck.ok, 'Import der eigenen Sicherung gelingt');
  wahr(JSON.stringify(zurueck.daten) === JSON.stringify(pruefung.daten), 'Daten nach dem Rundlauf identisch');
  const ids = (daten) => [
    ...daten.surfaces.flatMap((f) => (f.oeffnungen ?? []).map((o) => o.id)),
    ...daten.radiators.map((h) => h.id),
    ...daten.consumption.flatMap((v) => v.monate.map((m) => m.id)),
  ].join();
  wahr(ids(zurueck.daten) === ids(pruefung.daten) && ids(pruefung.daten).includes('oe-wohnen-fenster') && ids(pruefung.daten).includes('hk-bad-handtuch'),
    'IDs der Öffnungen, Heizkörper und Monate bleiben unverändert');
});

test('Export: Kopfdaten, deutsche Schlüssel und die Listen für die Stufen 2 und 3', () => {
  const speicher = { settings: [{ id: 'projekt' }], rooms: [{ id: 'r1', name: 'R' }] };
  const e = baueExport(speicher, new Date('2026-10-24T12:00:00Z'));
  wahr(e.format === 'heizlast-projekt' && e.schemaVersion === SCHEMA_VERSION && e.app === 'Heizlast', 'Kennung und Version');
  wahr(e.exportiertAm === '2026-10-24T12:00:00.000Z', 'Zeitpunkt');
  wahr(Object.values(DATEI_SCHLUESSEL).every((k) => Array.isArray(e.daten[k])), 'alle Listen vorhanden');
  wahr(Array.isArray(e.daten.fotos) && Array.isArray(e.daten.markierungen) && Array.isArray(e.daten.szenarien), 'Fotos, Markierungen und Szenarien vorbereitet');
  wahr(e.daten.raeume[0].id === 'r1', 'Räume stehen unter „raeume“');
});

test('Dateiname der Sicherung enthält das Datum', () => {
  wahr(exportDateiname(new Date(2026, 9, 24)) === 'heizlast-sicherung-2026-10-24.json', 'Dateiname');
  wahr(exportDateiname(new Date(2027, 0, 5)) === 'heizlast-sicherung-2027-01-05.json', 'zweistellige Monate und Tage');
  wahr(datumText(new Date(2026, 9, 4)) === '04.10.2026', 'Datum auf Deutsch');
});

// --- Fehlerhafte Dateien --------------------------------------------------------------------

const gueltig = () => ({
  format: 'heizlast-projekt', schemaVersion: 1, exportiertAm: '2026-10-24T12:00:00.000Z', app: 'Heizlast',
  daten: { einstellungen: {}, raeume: [], raumflaechen: [], heizkoerper: [] },
});
const mit = (aenderung) => pruefeImport(JSON.stringify(aenderung(gueltig())));

test('Import: Datei ohne gültiges JSON wird abgelehnt', () => {
  const r = pruefeImport('das ist kein json {');
  wahr(!r.ok && r.fehler[0].includes('kein gültiges JSON'), 'Fehlermeldung');
});

test('Import: falsche Kennung, fehlende oder zu neue Version', () => {
  wahr(!mit((d) => ({ ...d, format: 'etwas-anderes' })).ok, 'falsche Kennung');
  wahr(!mit((d) => ({ ...d, schemaVersion: undefined })).ok, 'ohne Version');
  const neu = mit((d) => ({ ...d, schemaVersion: SCHEMA_VERSION + 1 }));
  wahr(!neu.ok && neu.fehler[0].includes('Version'), 'neuere Version wird abgelehnt');
  wahr(!mit((d) => ({ ...d, daten: undefined })).ok, 'ohne daten');
  wahr(!pruefeImport('[]').ok && !pruefeImport('"text"').ok, 'kein Objekt');
});

test('Import: fehlende, leere und doppelte IDs sind Fehler', () => {
  wahr(!mit((d) => { d.daten.raeume = [{ name: 'ohne ID' }]; return d; }).ok, 'fehlende ID');
  wahr(!mit((d) => { d.daten.raeume = [{ id: '' }]; return d; }).ok, 'leere ID');
  const doppelt = mit((d) => { d.daten.raeume = [{ id: 'a' }, { id: 'a' }]; return d; });
  wahr(!doppelt.ok && doppelt.fehler[0].includes('doppelt'), 'doppelte ID');
  wahr(!mit((d) => { d.daten.raeume = 'keine Liste'; return d; }).ok, 'Liste erwartet');
});

test('Import: doppelte Kennungen von Öffnungen und Heizkörpern über das ganze Projekt', () => {
  const oeffnung = mit((d) => {
    d.daten.raumflaechen = [
      { id: 'f1', oeffnungen: [{ id: 'o1', typId: 't' }] }, { id: 'f2', oeffnungen: [{ id: 'o1', typId: 't' }] },
    ];
    return d;
  });
  wahr(!oeffnung.ok && oeffnung.fehler[0].includes('o1'), 'Öffnung in zwei Flächen mit derselben ID');
  const heizkoerper = mit((d) => { d.daten.heizkoerper = [{ id: 'h1' }, { id: 'h1' }]; return d; });
  wahr(!heizkoerper.ok, 'doppelte Heizkörper-ID');
});

test('Import: Verweise ohne Ziel und unplausible Werte sind Hinweise, kein Abbruch', () => {
  const r = mit((d) => {
    d.daten.raeume = [{ id: 'r1', name: 'R', geschoss: 'EG', status: 'beheizt', theta: 20, flaeche: 0, hoehe: 7, luftwechsel: null }];
    d.daten.raumflaechen = [{ id: 'f1', raumId: 'gibt-es-nicht', bauteilId: 'auch-nicht', angrenzend: { art: 'aussen' }, oeffnungen: [] }];
    return d;
  });
  wahr(r.ok, 'Import gelingt trotzdem');
  wahr(r.verweise.some((v) => v.includes('Raum, den es in der Datei nicht gibt')) && r.verweise.some((v) => v.includes('unbekanntes Bauteil')), 'Verweise gemeldet');
  wahr(r.inhalt.some((m) => m.text.includes('Fläche ist 0')) && r.inhalt.some((m) => m.text.includes('Höhe')), 'Fläche 0 und Höhe 7 m als Hinweis');
});

test('Import: fehlende Einstellungen werden mit Standardwerten ergänzt', () => {
  const r = mit((d) => { d.daten.einstellungen = { thetaAussen: -10 }; return d; });
  const e = r.daten.settings[0];
  wahr(e.thetaAussen === -10 && e.id === 'projekt', 'vorhandener Wert bleibt');
  wahr(e.dUWB.min === 0.05 && e.luftwechselStandard.max === 1 && e.spreizung === 5, 'fehlende Werte ergänzt');
  const ohne = mit((d) => { delete d.daten.einstellungen; return d; });
  wahr(ohne.ok && ohne.daten.settings[0].thetaAussen === -8, 'ganz ohne Einstellungen: Standard');
});

test('Import: Öffnungen ohne ID bekommen eine, ältere Verbrauchsabgleiche werden übernommen', () => {
  const r = mit((d) => {
    d.daten.raumflaechen = [{ id: 'f1', oeffnungen: [{ typId: 't' }, { id: 'vorhanden', typId: 't' }] }];
    d.daten.verbrauch = [{ id: 'v1', name: 'Alt', gasKwh: 1000, warmwasserKwh: 200, innentemperatur: 20.5, monate: [] }];
    return d;
  });
  wahr(r.ok, 'Import gelingt');
  const o = r.daten.surfaces[0].oeffnungen;
  wahr(typeof o[0].id === 'string' && o[0].id !== '' && o[1].id === 'vorhanden', 'fehlende ID ergänzt, vorhandene bleibt');
  const v = r.daten.consumption[0];
  wahr(v.nichtFuerHeizungKwh === 200 && v.innentemperaturSoll === 20.5 && v.innentemperaturIst.min === null, 'älterer Abgleich übernommen');
});

test('Zusammenfassung zählt auch die eingebetteten Öffnungen', () => {
  const z = zusammenfassung({ rooms: [{}, {}], surfaces: [{ oeffnungen: [{}, {}] }, { oeffnungen: [{}] }, {}], radiators: [{}] });
  wahr(z.raeume === 2 && z.raumflaechen === 3 && z.oeffnungen === 3 && z.heizkoerper === 1 && z.zonen === 0, JSON.stringify(z));
});

// --- Sicherungsstatus und Banner ---------------------------------------------------------------

const vor = (tage, stunden = 0) => new Date(Date.UTC(2026, 9, 24, 12) - (tage * 24 + stunden) * 3600 * 1000).toISOString();
const jetzt = new Date(Date.UTC(2026, 9, 24, 12));

test('Sicherungsstatus: bis 14 Tage aktuell, danach überfällig', () => {
  const status = (tage, stunden) => sicherungsStatus({ jetzt, letzteSicherung: vor(tage, stunden), start: vor(100) });
  wahr(!status(0).ueberfaellig && status(0).tage === 0, 'heute');
  wahr(!status(13).ueberfaellig && status(13).tage === 13, '13 Tage');
  wahr(!status(14).ueberfaellig, 'genau 14 Tage sind noch nicht älter als 14 Tage');
  wahr(status(14, 1).ueberfaellig && status(14, 1).tage === 14, '14 Tage und eine Stunde sind überfällig');
  wahr(status(15).ueberfaellig && status(15).tage === 15, '15 Tage');
  wahr(status(30).ueberfaellig, '30 Tage');
});

test('Sicherungsstatus ohne Sicherung: zählt ab Beginn der Nutzung', () => {
  const neu = sicherungsStatus({ jetzt, letzteSicherung: null, start: vor(5) });
  wahr(neu.nie && !neu.ueberfaellig && neu.tage === 5, 'seit 5 Tagen in Benutzung, noch kein Banner');
  const alt = sicherungsStatus({ jetzt, letzteSicherung: null, start: vor(20) });
  wahr(alt.nie && alt.ueberfaellig && alt.tage === 20, 'seit 20 Tagen ohne Sicherung: überfällig');
  wahr(!sicherungsStatus({ jetzt, letzteSicherung: null, start: null }).ueberfaellig, 'ohne Anhaltspunkt kein Banner');
});

test('Banner: Text nur bei überfälliger Sicherung, mit Alter und Datum', () => {
  wahr(bannerText(sicherungsStatus({ jetzt, letzteSicherung: vor(3), start: vor(100) })) === null, 'aktuell: kein Banner');
  const text = bannerText(sicherungsStatus({ jetzt, letzteSicherung: vor(20), start: vor(100) }));
  wahr(text.includes('20 Tage alt') && text.includes('vom 04.10.2026'), `Text: ${text}`);
  const nie = bannerText(sicherungsStatus({ jetzt, letzteSicherung: null, start: vor(20) }));
  wahr(nie.includes('Noch nie gesichert') && nie.includes('20 Tagen'), `Text: ${nie}`);
});
