// Tests für Szenarien: Abweichungen anwenden, Vergleich, Schreibschutz, Export und Bericht.
// Die Handrechnungen stehen als Kommentar bei den Tests.

import { test, wahr, gleich } from './runner.js';
import { pruefeImport, projektAusSpeicher, baueExport, SCHEMA_VERSION } from '../js/io.js';
import { rechne } from '../js/daten.js';
import * as db from '../js/db.js';
import {
  neuesSzenario, kopiereSzenario, benenneUm, loescheSzenario, normalisiereSzenario, wendeSzenarioAn, beschreibeAbweichungen,
  validiereSzenario, zaehleAbweichungen, szenarioInfo, kostenNachFoerderung, leereKosten,
} from '../js/szenario.js';
import { baueVergleich, vergleichTabellen, verlusteNachArt, VERLUST_ARTEN, minderungText, AUSLEGUNGSWERT } from '../js/vergleich.js';
import { berechneJahreswaerme, vergleichsannahmen, loeseGradtageAuf, JAHRESHINWEIS } from '../js/jahreswaerme.js';
import { baueBericht, baueVergleichsBericht } from '../js/bericht.js';

async function ladeText() {
  const adresse = new URL('../examples/beispiel-mini-haus.json', import.meta.url);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(adresse, 'utf8');
  }
  return (await fetch(adresse)).text();
}
const beispiel = async () => projektAusSpeicher(pruefeImport(await ladeText()).daten);
const jetzt = new Date(2026, 9, 24);
const zaehler = (() => { let n = 0; return () => `id-${(n += 1)}`; })();

// Ein Raum, ein Flachdach: Handrechnung ohne Nebenwirkungen.
//   Raum 10 m², lichte Höhe 2,5 m (25 m³), 20 °C innen, −8 °C außen, ΔT = 28 K
//   ΔU_WB = 0,10 W/(m²K) fest (min = max), Luftwechsel 0,5 1/h fest, Dach 10 m² mit U = 1,0 fest
const mini = () => ({
  einstellungen: {
    projektname: 'Mini', thetaAussen: -8, dUWB: { min: 0.1, max: 0.1 }, luftwechselStandard: { min: 0.5, max: 0.5 }, fg: 1,
    aufheizzuschlag: { aktiv: false, wProM2: 0 }, spreizung: 5, heizkoerperExponent: 1.3, zielVorlauf: 45,
  },
  zonen: [],
  bauteile: [{ id: 'bt-dach', name: 'Flachdach', art: 'dach', u: { min: 1, max: 1 }, aufbau: '', quelle: 'schaetzung' }],
  oeffnungstypen: [],
  raeume: [{ id: 'r', name: 'Raum', geschoss: 'EG', status: 'beheizt', theta: 20, flaeche: 10, hoehe: 2.5, volumenManuell: null, luftwechsel: null, waermeLieferanten: [] }],
  flaechen: [{ id: 'f', raumId: 'r', bauteilId: 'bt-dach', angrenzend: { art: 'aussen' }, modus: 'flaeche', flaeche: 10, oeffnungen: [] }],
  heizkoerper: [],
  verbrauch: [],
});

const tiefEinfrieren = (x) => {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const k of Object.keys(x)) tiefEinfrieren(x[k]);
  }
  return x;
};
const heizlastMittel = (projekt) => rechne(projekt).ergebnis.gebaeude.mittel.summe;

// --- Rechnen mit Abweichungen ------------------------------------------------------------------------

// Flachdach: U von 1,0 auf 0,20, ΔU_WB 0,10, innen 20 °C, außen −8 °C:
//   Ist:       Φ_T = 10 m² · (1,0 + 0,10) · 28 K = 308 W
//   Szenario:  Φ_T = 10 m² · (0,2 + 0,10) · 28 K =  84 W
//   Minderung  = 10 · (1,0 − 0,2) · 28 = 10 · 0,8 · 28 = 224 W
// Lüftung bleibt gleich: Φ_V = 0,34 · 0,5 · 25 m³ · 28 K = 119 W (Ist: 308 + 119 = 427 W, Szenario: 84 + 119 = 203 W)
test('Szenario Flachdach: U 1,0 → 0,20 mindert die Heizlast um 224 W', () => {
  const ist = mini();
  const sz = neuesSzenario('s1', 'Dach gedämmt');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  const v = baueVergleich(ist, [sz]);
  const [basis, szen] = v.spalten;
  gleich(basis.mittel, 427, 1e-9, 'Ist: 308 W + 119 W');
  gleich(szen.mittel, 203, 1e-9, 'Szenario: 84 W + 119 W');
  gleich(szen.minderungW, 224, 1e-9, 'Minderung 10 · 0,8 · 28');
  gleich(szen.minderungProzent, (224 / 427) * 100, 1e-9, '224 W von 427 W');
  wahr(minderungText(szen) === '0,22 kW (52,5 %)', minderungText(szen));
  gleich(basis.verluste.dach, 308, 1e-9, 'Dach im Ist-Zustand');
  gleich(szen.verluste.dach, 84, 1e-9, 'Dach im Szenario');
  gleich(szen.verluste.lueftung, 119, 1e-9, 'Lüftung unverändert');
  gleich(szen.verluste.dach + szen.verluste.lueftung, szen.mittel, 1e-9, 'Summe der Verlustarten = Gebäudeheizlast');
});

// Soll-Temperatur 21 °C statt 20 °C (ΔT = 29 K): Dach 10 · 1,1 · 29 = 319 W, Lüftung 0,34 · 0,5 · 25 · 29 = 123,25 W → 442,25 W (+15,25 W)
// Luftwechsel 1,0 statt 0,5 (ΔT 28 K): Lüftung 0,34 · 1,0 · 25 · 28 = 238 W (+119 W), Dach 308 W → 546 W
test('Szenario: Soll-Temperatur und Luftwechsel (Standard und je Raum) wirken auf die Heizlast', () => {
  const ist = mini();
  const warm = neuesSzenario('w', 'wärmer');
  warm.abweichungen.raumTemperatur.r = { name: 'Raum', theta: 21 };
  gleich(heizlastMittel(wendeSzenarioAn(ist, warm).projekt), 442.25, 1e-9, '319 W + 123,25 W');

  const luft = neuesSzenario('l', 'mehr Lüftung');
  luft.abweichungen.luftwechselStandard = { min: 1, max: 1 };
  gleich(heizlastMittel(wendeSzenarioAn(ist, luft).projekt), 546, 1e-9, '308 W + 238 W');

  const raumLuft = neuesSzenario('rl', 'Raum mit eigenem Luftwechsel');
  raumLuft.abweichungen.luftwechselRaum.r = { name: 'Raum', min: 1, max: 1 };
  gleich(heizlastMittel(wendeSzenarioAn(ist, raumLuft).projekt), 546, 1e-9, 'Raumwert geht dem Standard vor');
  wahr(ist.raeume[0].luftwechsel === null && ist.raeume[0].theta === 20, 'Ist-Zustand unverändert');
});

test('Szenario: Öffnungs-Uw, Ziel-Vorlauf und Spreizung werden übernommen', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Fenster neu');
  sz.abweichungen.oeffnungstypen['ot-fenster'] = { name: 'Fenster 2-fach', uw: 1.0 };
  sz.abweichungen.einstellungen = { zielVorlauf: 40, spreizung: 7 };
  const { projekt } = wendeSzenarioAn(ist, sz);
  wahr(projekt.oeffnungstypen.find((t) => t.id === 'ot-fenster').uw === 1.0 && ist.oeffnungstypen.find((t) => t.id === 'ot-fenster').uw === 2.7, 'Uw im Szenario 1,0, im Ist 2,7');
  wahr(projekt.einstellungen.zielVorlauf === 40 && projekt.einstellungen.spreizung === 7 && ist.einstellungen.zielVorlauf === 55 && ist.einstellungen.spreizung === 5, 'Einstellungen');
  wahr(heizlastMittel(projekt) < heizlastMittel(ist), 'bessere Fenster senken die Heizlast');
});

// Bad: Handtuchheizkörper 1000 W bei 55/45/20 (n = 1,25), Heizlast (ungünstig) 1078,4 W, Raum 22 °C, Spreizung 5 K.
// Ist: nötige Vorlauftemperatur 56,1 °C. Szenario: zusätzlich ein Plattenheizkörper 600 W bei 55/45/20 (n = 1,3).
// Probe bei 46,4 °C Vorlauf (Rücklauf 41,4 °C): ΔT_log = 5 / ln(24,4 / 19,4) = 21,76 K, Normwert ΔT_log,n = 10 / ln(35 / 25) = 29,72 K,
//   Verhältnis 0,732 → Handtuch 1000 · 0,732^1,25 = 677 W, Platte 600 · 0,732^1,3 = 400 W, Summe 1077 W ≈ Heizlast 1078 W
test('Szenario mit zusätzlichem Heizkörper senkt die nötige Vorlauftemperatur des Raums (56,1 → 46,4 °C)', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Platte im Bad');
  const neu = {
    id: 'hk-szenario', raumId: 'raum-bad', bauart: 'platten', typ: '22', status: 'neu', material: 'stahl', ventil: 'neu', bauhoehe: 600, baulaenge: 1000, bautiefe: 100,
    nabenabstand: null, gliederzahl: null, leistungJeGlied: null, normleistung: 600, normVorlauf: 55, normRuecklauf: 45, normRaum: 20, exponent: null,
    kennlinie: [], kennlinieRaumtemperatur: 20, notiz: '', name: 'Plattenheizkörper in „Bad“',
  };
  sz.abweichungen.neueHeizkoerper.push(neu);
  const [basis, szen] = baueVergleich(ist, [sz]).spalten;
  const bad = (sp) => sp.bewertung.zeilen.find((r) => r.raumId === 'raum-bad');
  gleich(bad(basis).vorlauf.vorlauf, 56.1356, 1e-3, 'Ist: Vorlauf 56,1 °C');
  const v = bad(szen).vorlauf.vorlauf;
  wahr(v < bad(basis).vorlauf.vorlauf - 5, `Szenario deutlich niedriger: ${v}`);
  // Unabhängige Probe: Leistung beider Heizkörper bei der gefundenen Vorlauftemperatur = Heizlast
  const dtLog = (tV, tR, ti) => (tV - tR) / Math.log((tV - ti) / (tR - ti));
  const phi = (pn, n, tV) => pn * (dtLog(tV, tV - 5, 22) / dtLog(55, 45, 20)) ** n;
  gleich(phi(1000, 1.25, v) + phi(600, 1.3, v), bad(szen).heizlast, 0.5, 'Summe der Leistungen = Heizlast des Bades');
  gleich(v, 46.37, 0.01, 'Vorlauf 46,4 °C');
  wahr(ist.heizkoerper.length === 4 && !ist.heizkoerper.some((h) => h.id === 'hk-szenario'), 'der Heizkörper existiert nur im Szenario');
  wahr(wendeSzenarioAn(ist, sz).projekt.heizkoerper.find((h) => h.id === 'hk-szenario').szenarioEigen === true, 'als szenario-eigen markiert');
  // Unterdeckung: im Ist-Zustand deckt das Bad bei 55 °C nur 96 %, im Szenario 153 %
  wahr(basis.raeumeMitUnterdeckung === 1 && szen.raeumeMitUnterdeckung === 0, `Unterdeckung ${basis.raeumeMitUnterdeckung} → ${szen.raeumeMitUnterdeckung}`);
});

test('Szenario: Heizkörper-Status „entfällt“ nimmt den Heizkörper aus der Deckung', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Bad ohne Handtuchheizkörper');
  sz.abweichungen.heizkoerperStatus['hk-bad-handtuch'] = { name: 'Handtuchheizkörper', status: 'entfaellt' };
  const [, szen] = baueVergleich(ist, [sz]).spalten;
  wahr(szen.bewertung.zeilen.find((r) => r.raumId === 'raum-bad').vorlauf.status === 'kein_heizkoerper', 'Bad ohne Heizkörper');
  wahr(ist.heizkoerper.find((h) => h.id === 'hk-bad-handtuch').status === 'neu', 'Ist-Zustand behält „neu“');
});

// --- Der Ist-Zustand bleibt unverändert ------------------------------------------------------------

test('Ist-Zustand ist nach Anlegen, Bearbeiten, Kopieren, Umbenennen und Löschen von Szenarien unverändert (Vergleich der kompletten Daten)', async () => {
  const ist = await beispiel();
  const vorher = JSON.stringify(ist);
  tiefEinfrieren(ist); // jeder Schreibversuch würde in einem ES-Modul sofort einen Fehler auslösen

  let liste = [];
  let sz = neuesSzenario('s1', 'Alles gedämmt');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  sz.abweichungen.bauteile['bt-aussenwand'] = { name: 'Außenwand', u: { min: 0.3, max: 0.4 } };
  sz.abweichungen.oeffnungstypen['ot-fenster'] = { name: 'Fenster', uw: 1.1 };
  sz.abweichungen.raumTemperatur['raum-bad'] = { name: 'Bad', theta: 24 };
  sz.abweichungen.luftwechselRaum['raum-bad'] = { name: 'Bad', min: 0.3, max: 0.5 };
  sz.abweichungen.luftwechselStandard = { min: 0.4, max: 0.6 };
  sz.abweichungen.heizkoerperStatus['hk-wohnen-platte'] = { name: 'Platte', status: 'entfaellt' };
  sz.abweichungen.einstellungen = { zielVorlauf: 35, spreizung: 8 };
  sz.abweichungen.neueHeizkoerper.push({ id: 'n1', raumId: 'raum-wohnen', bauart: 'wp', status: 'neu', kennlinie: [{ vorlauf: 35, leistung: 800 }, { vorlauf: 45, leistung: 1200 }], kennlinieRaumtemperatur: 20, ventil: 'neu', name: 'WP' });
  liste.push(sz);                                  // Anlegen
  wendeSzenarioAn(ist, sz);                        // Anwenden
  baueVergleich(ist, liste);                       // Vergleichen
  baueVergleichsBericht(ist, liste, jetzt);        // Bericht
  baueBericht(wendeSzenarioAn(ist, sz).projekt, jetzt, { szenario: szenarioInfo(ist, sz) });
  const k = kopiereSzenario(sz, zaehler);          // Kopieren
  liste.push(k);
  liste = liste.map((x) => (x.id === k.id ? benenneUm(x, 'Kopie umbenannt', 'Beschreibung') : x));   // Umbenennen
  k.abweichungen.bauteile['bt-dach'].u.min = 0.5;  // Bearbeiten der Kopie
  liste = loescheSzenario(liste, 's1');            // Löschen
  wahr(liste.length === 1 && liste[0].name === 'Kopie umbenannt', 'Liste nach den Operationen');
  wahr(JSON.stringify(ist) === vorher, 'Ist-Zustand ist unverändert');
});

test('Szenario kopieren: neue Kennungen, tiefe Kopie, Original bleibt bei Änderungen der Kopie unverändert', () => {
  const sz = neuesSzenario('s1', 'Dach');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  sz.abweichungen.neueHeizkoerper.push({ id: 'n1', raumId: 'r', bauart: 'platten', status: 'neu' });
  const k = kopiereSzenario(sz, zaehler, null, jetzt);
  wahr(k.id !== sz.id && k.name === 'Dach (Kopie)', 'neue Id, Name mit „(Kopie)“');
  wahr(k.abweichungen.neueHeizkoerper[0].id !== 'n1', 'szenario-eigene Heizkörper bekommen neue Kennungen');
  k.abweichungen.bauteile['bt-dach'].u.min = 0.9;
  wahr(sz.abweichungen.bauteile['bt-dach'].u.min === 0.2, 'Original unverändert');
  wahr(kopiereSzenario(sz, zaehler, 'Eigener Name').name === 'Eigener Name', 'Name frei wählbar');
});

test('Szenario normalisieren: fehlende oder falsche Teile werden ergänzt', () => {
  const n = normalisiereSzenario({ id: 'x', abweichungen: { bauteile: 'kaputt', neueHeizkoerper: null } });
  wahr(n.name === '' && n.beschreibung === '' && n.abweichungen.bauteile && Object.keys(n.abweichungen.bauteile).length === 0, 'Leerwerte');
  wahr(Array.isArray(n.abweichungen.neueHeizkoerper) && n.abweichungen.luftwechselStandard === null, 'Listen und null');
  wahr(normalisiereSzenario(undefined).abweichungen.einstellungen !== undefined, 'auch ohne Eingabe');
  gleich(zaehleAbweichungen(neuesSzenario('a')), 0, 0, 'leeres Szenario hat keine Abweichungen');
});

// --- Hinweise bei fehlenden Zielen -----------------------------------------------------------------------

test('Abweichung auf ein im Ist-Zustand gelöschtes Bauteil erzeugt einen Hinweis statt stiller Rechnung', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Dach gedämmt');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  const ohneBauteil = { ...ist, bauteile: ist.bauteile.filter((b) => b.id !== 'bt-dach'), flaechen: ist.flaechen.filter((f) => f.bauteilId !== 'bt-dach') };
  const { projekt, hinweise } = wendeSzenarioAn(ohneBauteil, sz);
  wahr(hinweise.length === 1 && hinweise[0].art === 'bauteil_fehlt' && hinweise[0].text.includes('„Flachdach“') && hinweise[0].text.includes('nicht mehr'), JSON.stringify(hinweise));
  wahr(!projekt.bauteile.some((b) => b.id === 'bt-dach'), 'das gelöschte Bauteil taucht nicht wieder auf');
  const zeile = beschreibeAbweichungen(ohneBauteil, sz)[0];
  wahr(zeile.hinweis !== null && zeile.ist === 'nicht mehr vorhanden' && zeile.ziel === 'Flachdach', 'Editor-Zeile mit Hinweis und gemerktem Namen');
  const v = baueVergleich(ohneBauteil, [sz]);
  wahr(v.spalten[1].szenarioHinweise.length === 1 && vergleichTabellen(v).kennzahlen.zeilen.some((z) => z[0].startsWith('Hinweise') && z[2] === '1'), 'Hinweis erscheint im Vergleich');
  gleich(v.spalten[1].mittel, v.spalten[0].mittel, 1e-9, 'die Abweichung wirkt nicht: gleiche Heizlast');
});

test('Hinweise auch für gelöschte Heizkörper, Räume, Öffnungstypen und doppelte Kennungen', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Verwaist');
  sz.abweichungen.heizkoerperStatus.gibtsNicht = { name: 'Alter Heizkörper', status: 'entfaellt' };
  sz.abweichungen.oeffnungstypen.weg = { name: 'Altes Fenster', uw: 1 };
  sz.abweichungen.raumTemperatur.fort = { name: 'Gästezimmer', theta: 22 };
  sz.abweichungen.luftwechselRaum.fort = { name: 'Gästezimmer', min: 1, max: 1 };
  sz.abweichungen.neueHeizkoerper.push({ id: 'n1', raumId: 'fort', bauart: 'platten', status: 'neu', name: 'Platte im Gästezimmer' });
  sz.abweichungen.neueHeizkoerper.push({ id: 'hk-bad-handtuch', raumId: 'raum-bad', bauart: 'platten', status: 'neu', name: 'doppelt' });
  const arten = wendeSzenarioAn(ist, sz).hinweise.map((h) => h.art).sort();
  wahr(arten.join() === 'heizkoerper_fehlt,id_doppelt,oeffnungstyp_fehlt,raum_fehlt,raum_fehlt,raum_fehlt', arten.join());
  gleich(heizlastMittel(wendeSzenarioAn(ist, sz).projekt), heizlastMittel(ist), 1e-9, 'nichts davon wirkt');
});

// --- Prüfung beim Speichern -----------------------------------------------------------------------------

test('Szenario prüfen: Name Pflicht, U-Wert-Reihenfolge, Zahlen, Heizkörper mit Normbedingungen', () => {
  const sz = neuesSzenario('s', '  ');
  wahr(validiereSzenario(sz).some((m) => m.stufe === 'fehler' && m.feld === 'name'), 'leerer Name');
  sz.name = 'Test';
  sz.abweichungen.bauteile.a = { name: 'Dach', u: { min: 0.9, max: 0.2 } };
  sz.abweichungen.oeffnungstypen.b = { name: 'Fenster', uw: null };
  sz.abweichungen.raumTemperatur.c = { name: 'Bad', theta: NaN };
  sz.abweichungen.einstellungen = { zielVorlauf: 80, spreizung: 0 };
  const fehler = validiereSzenario(sz).filter((m) => m.stufe === 'fehler').map((m) => m.feld);
  wahr(['bauteile.a', 'oeffnungstypen.b', 'raumTemperatur.c', 'einstellungen.spreizung'].every((f) => fehler.includes(f)), `Fehler: ${fehler}`);
  wahr(validiereSzenario(sz).some((m) => m.stufe === 'warnung' && m.feld === 'einstellungen.zielVorlauf'), '80 °C Vorlauf ist ungewöhnlich');

  const hk = neuesSzenario('h', 'Heizkörper');
  hk.abweichungen.neueHeizkoerper.push({ id: 'n', raumId: 'r', bauart: 'platten', status: 'neu', ventil: 'neu', normleistung: 800, normVorlauf: null, normRuecklauf: null, normRaum: null, kennlinie: [] });
  wahr(validiereSzenario(hk).some((m) => m.stufe === 'fehler' && m.feld === 'neueHeizkoerper.n.normWahl'), 'Normbedingungen sind auch im Szenario Pflicht');
  const gut = neuesSzenario('g', 'Gut');
  gut.abweichungen.bauteile.a = { name: 'Dach', u: { min: 0.2, max: 0.2 } };
  wahr(validiereSzenario(gut).length === 0, 'gültiges Szenario ohne Meldungen');
});

// --- Vergleichstabellen --------------------------------------------------------------------------------

test('Verluste nach Art: Summe entspricht der Gebäudeheizlast, Beispielhaus und Szenario', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Dach und Fenster');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  sz.abweichungen.oeffnungstypen['ot-fenster'] = { name: 'Fenster', uw: 1.0 };
  const v = baueVergleich(ist, [sz]);
  for (const sp of v.spalten) {
    const summe = VERLUST_ARTEN.reduce((s, a) => s + sp.verluste[a.id], 0);
    gleich(summe, sp.mittel, 1e-6, `${sp.name}: Summe der Verlustarten = Gebäudeheizlast`);
    wahr(['dach', 'aussenwand', 'fenster', 'kellerdecke', 'erdreich', 'nachbar', 'lueftung'].every((a) => sp.verluste[a] > 0), `${sp.name}: jede Art kommt vor`);
  }
  const [basis, szen] = v.spalten;
  wahr(szen.verluste.dach < basis.verluste.dach && szen.verluste.fenster < basis.verluste.fenster, 'Dach und Fenster sinken');
  gleich(szen.verluste.aussenwand, basis.verluste.aussenwand, 1e-9, 'Außenwand unverändert');
  gleich(szen.verluste.erdreich, basis.verluste.erdreich, 1e-9, 'Erdreich unverändert');
  gleich(szen.verluste.lueftung, basis.verluste.lueftung, 1e-9, 'Lüftung unverändert');
  gleich(verlusteNachArt(ist, null).dach, 0, 0, 'ohne Ergebnis alles 0');
});

test('Vergleichstabellen: Kennzahlen, Räume und Verluste nebeneinander', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Dach gedämmt');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  const t = vergleichTabellen(baueVergleich(ist, [sz]));
  wahr(t.kennzahlen.kopf.join() === 'Kennzahl,Ist-Zustand,Dach gedämmt', 'Kopf der Kennzahlen');
  const zeile = (name) => t.kennzahlen.zeilen.find((z) => z[0].startsWith(name));
  wahr(zeile('Gebäudeheizlast (')[1] === '2332 – 3816 W', zeile('Gebäudeheizlast (')[1]);
  wahr(zeile('Gebäudeheizlast, Mittelwert')[1] === '3074 W', 'Mittelwert');
  wahr(zeile('Minderung')[1] === '–' && /^\d,\d\d kW \(\d+,\d %\)$/.test(zeile('Minderung')[2]), `Minderung: ${zeile('Minderung')[2]}`);
  wahr(zeile('Nötige Vorlauftemperatur')[1] === '56,1 °C (Bad)', zeile('Nötige Vorlauftemperatur')[1]);
  wahr(zeile('Ziel-Vorlauftemperatur')[1] === '55 °C' && zeile('Räume mit Unterdeckung')[1] === '1 von 2', 'Ziel und Unterdeckung');
  gleich(t.raeume.zeilen.length, 3, 0, 'drei gerechnete Räume (beheizt und passiv)');
  wahr(t.raeume.kopf.join() === 'Raum,Ist-Zustand: Heizlast,Vorlauf,Dach gedämmt: Heizlast,Vorlauf', t.raeume.kopf.join());
  const flur = t.raeume.zeilen.find((z) => z[0] === 'Flur');
  wahr(flur[2] === 'passiv', 'passiver Raum ohne Vorlauftemperatur');
  const dach = t.transmission.zeilen.find((z) => z[0] === 'Dach');
  wahr(dach[1] === '924 W' && /^\d+ W \(−\d+ W\)$/.test(dach[2]), `Dach: ${dach.join(' | ')}`);
  wahr(t.transmission.zeilen[t.transmission.zeilen.length - 1][0] === 'Summe = Gebäudeheizlast' && t.transmission.zeilen[t.transmission.zeilen.length - 1][1] === '3074 W', 'Summenzeile');
});

// --- Schreibschutz ----------------------------------------------------------------------------------

test('Schreibschutz: Bestandsdaten sind bei aktivem Szenario nicht beschreibbar, Import ebenfalls', async () => {
  wahr(db.istSchreibgeschuetzt() === false, 'zu Beginn offen');
  db.setzeSchreibschutz(true);
  try {
    for (const store of ['settings', 'zones', 'components', 'openingTypes', 'rooms', 'surfaces', 'radiators', 'consumption']) {
      let fehler = null;
      try { await db.speichere(store, { id: 'x' }); } catch (e) { fehler = e; }
      wahr(fehler instanceof db.SchreibschutzFehler, `speichere(${store}) wird gesperrt`);
      fehler = null;
      try { await db.loesche(store, 'x'); } catch (e) { fehler = e; }
      wahr(fehler instanceof db.SchreibschutzFehler, `loesche(${store}) wird gesperrt`);
    }
    let importFehler = null;
    try { await db.ersetzeAlles({}); } catch (e) { importFehler = e; }
    wahr(importFehler instanceof db.SchreibschutzFehler, 'Import (ersetzeAlles) wird gesperrt');
    wahr(importFehler.message.includes('Ist-Zustand'), 'Meldung nennt den Ist-Zustand');
  } finally {
    db.setzeSchreibschutz(false);
  }
  wahr(db.istSchreibgeschuetzt() === false, 'wieder offen');
});

// --- Export und Import ----------------------------------------------------------------------------------

test('Export enthält Szenarien (ab schemaVersion 2), Import übernimmt sie, alte Dateien (Version 1) bleiben lesbar', async () => {
  const text = await ladeText();
  wahr(JSON.parse(text).schemaVersion === 1 && SCHEMA_VERSION === 3, 'Beispieldatei ist Version 1, die App schreibt Version 3');
  const alt = pruefeImport(text);
  wahr(alt.ok && alt.zusammenfassung.szenarien === 0, 'Version 1 wird gelesen, ohne Szenarien');

  const speicher = alt.daten;
  const sz = neuesSzenario('s1', 'Dach gedämmt', jetzt);
  sz.beschreibung = 'Flachdach auf U 0,2';
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  sz.abweichungen.neueHeizkoerper.push({ id: 'n1', raumId: 'raum-bad', bauart: 'platten', status: 'neu', ventil: 'neu', normleistung: 600, normVorlauf: 55, normRuecklauf: 45, normRaum: 20, kennlinie: [] });
  speicher.scenarios = [sz];
  const datei = baueExport(speicher, jetzt);
  wahr(datei.schemaVersion === 3 && datei.daten.szenarien.length === 1 && datei.daten.szenarien[0].name === 'Dach gedämmt', 'Export mit Szenario');
  const zurueck = pruefeImport(JSON.stringify(datei));
  wahr(zurueck.ok && zurueck.zusammenfassung.szenarien === 1, 'Import');
  wahr(JSON.stringify(zurueck.daten.scenarios[0]) === JSON.stringify(normalisiereSzenario(sz)), 'Szenario nach dem Import unverändert');
  wahr(zurueck.verweise.length === 0, 'keine Verweisprobleme');

  const neuer = JSON.parse(JSON.stringify(datei));
  neuer.schemaVersion = 4;
  const abgelehnt = pruefeImport(JSON.stringify(neuer));
  wahr(!abgelehnt.ok && abgelehnt.fehler[0].includes('Version 3'), 'Dateien neuerer Version werden abgelehnt');
});

test('Import normalisiert unvollständige Szenarien und meldet Abweichungen ohne Ziel', async () => {
  const datei = JSON.parse(await ladeText());
  datei.schemaVersion = 2;
  datei.daten.szenarien = [
    { id: 'roh', name: 'Roh' },
    { id: 'verwaist', name: 'Verwaist', abweichungen: { bauteile: { fort: { name: 'Altes Dach', u: { min: 0.2, max: 0.2 } } } } },
  ];
  const r = pruefeImport(JSON.stringify(datei));
  wahr(r.ok && r.daten.scenarios[0].abweichungen.bauteile && Array.isArray(r.daten.scenarios[0].abweichungen.neueHeizkoerper), 'fehlende Teile ergänzt');
  wahr(r.verweise.some((h) => h.includes('Szenario „Verwaist“') && h.includes('Altes Dach')), `Verweise: ${r.verweise.join(' | ')}`);
  datei.daten.szenarien = [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }];
  const doppelt = pruefeImport(JSON.stringify(datei));
  wahr(!doppelt.ok && doppelt.fehler[0].includes('doppelt'), 'doppelte Szenario-Kennung wird abgelehnt');
});

// --- Bericht --------------------------------------------------------------------------------------------

test('Bericht für ein Szenario: Kopf, Abweichungen, Zahlen des Szenarios, kein Verbrauchsabgleich', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Dach gedämmt');
  sz.beschreibung = 'Flachdach nachträglich gedämmt';
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  const b = baueBericht(wendeSzenarioAn(ist, sz).projekt, jetzt, { szenario: szenarioInfo(ist, sz) });
  wahr(b.titel.includes('(Szenario)') && b.projektname.includes('Szenario: Dach gedämmt') && b.seitentitel.includes('Szenario Dach gedämmt'), `${b.titel} | ${b.projektname}`);
  const a = b.abschnitte.find((x) => x.titel.includes('Abweichungen'));
  wahr(a && JSON.stringify(a).includes('0,7 – 1,1 W/(m²K)') && JSON.stringify(a).includes('0,2 W/(m²K)') && JSON.stringify(a).includes('Flachdach nachträglich gedämmt'), 'Abweichungen mit Ist- und Szenario-Wert');
  const uebersicht = JSON.stringify(b.abschnitte[0]);
  wahr(uebersicht.includes('gilt für das Szenario') && !uebersicht.includes('2332 – 3816 W'), 'Übersicht zeigt Szenariowerte');
  wahr(!uebersicht.includes('Verbrauchsabgleich „'), 'kein Verbrauchsabgleich in der Übersicht');
  wahr(JSON.stringify(b.abschnitte.find((x) => x.titel.includes('Verbrauchsabgleich'))).includes('entfällt'), 'Abschnitt Verbrauchsabgleich entfällt');
  wahr(b.abschnitte.every((x, i) => x.titel.startsWith(`${i + 1} `)), 'Nummerierung');
  const normal = baueBericht(ist, jetzt);
  wahr(!JSON.stringify(normal).includes('Szenario'), 'Bericht für den Ist-Zustand enthält nichts zu Szenarien');
});

test('Bericht „Szenarienvergleich“: Kennzahlen, Räume, Verluste und Abweichungen je Szenario', async () => {
  const ist = await beispiel();
  const a = neuesSzenario('a', 'Dach gedämmt');
  a.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  const b2 = neuesSzenario('b', 'Leer');
  const b = baueVergleichsBericht(ist, [a, b2], jetzt);
  const titel = b.abschnitte.map((x) => x.titel);
  wahr(['Szenarienvergleich', 'Räume im Vergleich', 'Woher kommt die Änderung', 'Abweichungen je Szenario'].every((t) => titel.some((x) => x.includes(t))), titel.join(' | '));
  wahr(b.abschnitte.find((x) => x.titel.includes('Abweichungen je Szenario')).neueSeite === true, 'Abweichungen auf neuer Seite');
  const tabellen = b.abschnitte.flatMap((x) => x.bloecke).filter((x) => x.art === 'tabelle');
  wahr(tabellen.length === 5, `Kennzahlen, Jahreswärme, Räume, Verluste und eine Abweichungstabelle: ${tabellen.length}`);
  wahr(tabellen[0].kopf.join() === 'Kennzahl,Ist-Zustand,Dach gedämmt,Leer', tabellen[0].kopf.join());
  wahr(JSON.stringify(b.abschnitte.find((x) => x.titel.includes('Abweichungen je Szenario'))).includes('Keine Abweichungen'), 'Szenario ohne Abweichungen ist benannt');
  const leer = baueVergleichsBericht(ist, [], jetzt);
  wahr(leer.abschnitte.length === 1 && JSON.stringify(leer).includes('noch keine Szenarien'), 'ohne Szenarien nur ein Hinweis');
  wahr(b.titel.includes('Szenarienvergleich') && b.seitentitel.startsWith('Heizlast-Szenarienvergleich'), 'Titel');
});

test('beschreibeAbweichungen: Ist- und Szenario-Wert nebeneinander für alle Arten', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Alles');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  sz.abweichungen.oeffnungstypen['ot-fenster'] = { name: 'Fenster', uw: 1 };
  sz.abweichungen.heizkoerperStatus['hk-bad-handtuch'] = { name: 'Handtuch', status: 'entfaellt' };
  sz.abweichungen.raumTemperatur['raum-bad'] = { name: 'Bad', theta: 24 };
  sz.abweichungen.luftwechselStandard = { min: 0.4, max: 0.6 };
  sz.abweichungen.luftwechselRaum['raum-wohnen'] = { name: 'Wohnzimmer', min: 0.3, max: 0.3 };
  sz.abweichungen.einstellungen = { zielVorlauf: 40, spreizung: 10 };
  const zeilen = beschreibeAbweichungen(ist, sz);
  const finde = (bereich, ziel) => zeilen.find((z) => z.bereich.startsWith(bereich) && (ziel === undefined || z.ziel === ziel));
  wahr(finde('Bauteil').ist === '0,7 – 1,1 W/(m²K)' && finde('Bauteil').szenario === '0,2 W/(m²K)', 'Bauteil');
  wahr(finde('Öffnungstyp').ist === '2,7 W/(m²K)' && finde('Öffnungstyp').szenario === '1 W/(m²K)', 'Öffnungstyp');
  wahr(finde('Heizkörper (Status)').ist === 'Neu' && finde('Heizkörper (Status)').szenario === 'Entfällt', 'Heizkörper-Status');
  wahr(finde('Raum (Soll').ist === '22 °C' && finde('Raum (Soll').szenario === '24 °C', 'Raum-Temperatur');
  wahr(finde('Luftwechsel (Standard)').ist === '0,5 – 1 1/h' && finde('Luftwechsel (Standard)').szenario === '0,4 – 0,6 1/h', 'Luftwechsel Standard');
  wahr(finde('Raum (Luftwechsel)').ist === 'Standard (0,5 – 1 1/h)' && finde('Raum (Luftwechsel)').szenario === '0,3 1/h', 'Luftwechsel Raum');
  wahr(finde('Einstellung', 'Ziel-Vorlauftemperatur').ist === '55 °C' && finde('Einstellung', 'Spreizung Vor-/Rücklauf').szenario === '10 K', 'Einstellungen');
  gleich(zaehleAbweichungen(sz), 8, 0, 'acht Abweichungen');
});

// --- Kosten je Szenario (nur Eingabe) --------------------------------------------------------------------

// Investition 8000 bis 12000 €, Förderung 2000 bis 3000 €:
//   Kosten nach Förderung: von 8000 − 3000 = 5000 € (niedrigster Preis, höchste Förderung) bis 12000 − 2000 = 10000 €
test('Kosten: Eingabe als Bandbreite, Kosten nach Förderung = Investition minus Förderung (5000 bis 10000 €)', () => {
  const k = leereKosten();
  gleich(kostenNachFoerderung(k), null, 0, 'ohne Eingabe keine Kosten') ;
  k.investition = { min: 8000, max: 12000 };
  const ohneFoerderung = kostenNachFoerderung(k);
  wahr(ohneFoerderung.min === 8000 && ohneFoerderung.max === 12000, 'ohne Förderung gilt 0 €');
  k.foerderung = { min: 2000, max: 3000 };
  const nach = kostenNachFoerderung(k);
  wahr(nach.min === 5000 && nach.max === 10000, `${nach.min} bis ${nach.max}`);
  wahr(kostenNachFoerderung({ investition: { min: 8000, max: null }, foerderung: { min: 0, max: 0 } }) === null, 'unvollständige Investition zählt nicht');
});

test('Kosten: Prüfung (Pflicht beider Werte, nicht negativ, Reihenfolge), leer ist erlaubt, alte Szenarien erhalten leere Kosten', () => {
  const sz = neuesSzenario('s', 'Kosten');
  wahr(validiereSzenario(sz).length === 0, 'leere Kosten sind gültig');
  sz.kosten.investition = { min: 8000, max: null };
  wahr(validiereSzenario(sz).some((m) => m.stufe === 'fehler' && m.feld === 'kosten.investition'), 'nur Minimum: Fehler');
  sz.kosten.investition = { min: 12000, max: 8000 };
  wahr(validiereSzenario(sz).some((m) => m.stufe === 'fehler'), 'Minimum über Maximum: Fehler');
  sz.kosten.investition = { min: -5, max: 100 };
  wahr(validiereSzenario(sz).some((m) => m.stufe === 'fehler'), 'negativ: Fehler');
  sz.kosten.investition = { min: NaN, max: 100 };
  wahr(validiereSzenario(sz).some((m) => m.stufe === 'fehler'), 'unlesbar: Fehler');
  sz.kosten.investition = { min: 1000, max: 2000 };
  sz.kosten.foerderung = { min: 500, max: 3000 };
  wahr(validiereSzenario(sz).every((m) => m.stufe === 'warnung') && validiereSzenario(sz).length === 1, 'Förderung über Investition: Warnung');
  const alt = normalisiereSzenario({ id: 'alt', name: 'Alt' });
  wahr(alt.kosten.investition.min === null && alt.kosten.foerderung.max === null && alt.kosten.quelle === '', 'alte Szenarien ohne Kosten');
});

// --- Jahreswärme-Differenz ---------------------------------------------------------------------------------

// ΔΦ = 2000 W, θ_soll = 20 °C, θ_e = −8 °C (ΔT = 28 K), G = 3000 Kd:
//   ΔH = 2000 / 28 = 71,43 W/K
//   ΔQ = 71,43 · 24 · 3000 / 1000 = 5142,9 kWh/a (gerundet 5143)
//   JAZ 3,5:  ΔStrom = 5142,9 / 3,5 = 1469,4 kWh/a (gerundet 1469)
//   30 ct/kWh: 1469,4 · 0,30 = 440,8 €/a
test('Jahreswärme: ΔΦ 2000 W → ΔH 71,43 W/K, ΔQ 5143 kWh/a, mit JAZ 3,5 und 30 ct/kWh: 1469 kWh und 440,8 €/a', () => {
  const r = berechneJahreswaerme({ deltaPhi: { min: 2000, max: 2000 }, thetaMittel: 20, thetaAussen: -8, gradtage: 3000, jaz: { min: 3.5, max: 3.5 }, strompreis: { min: 30, max: 30 } });
  gleich(r.deltaH.min, 71.4286, 1e-4, 'ΔH');
  gleich(r.deltaQ.min, 5142.857, 1e-3, 'ΔQ');
  wahr(Math.round(r.deltaQ.min) === 5143, 'ΔQ gerundet 5143 kWh/a');
  gleich(r.deltaStrom.min, 1469.388, 1e-3, 'ΔStrom');
  wahr(Math.round(r.deltaStrom.min) === 1469, 'ΔStrom gerundet 1469 kWh/a');
  gleich(r.kosten.min, 440.816, 1e-3, 'Stromkosten');
  wahr(r.grund === null && r.deltaQ.min === r.deltaQ.max && r.kosten.min === r.kosten.max, 'ohne Unsicherheit ist die Bandbreite ein Punkt');
});

// Bandbreiten: ΔΦ 1800 bis 2200 W, ΔT = 28 K → ΔH 64,29 bis 78,57 W/K, G = 3000 Kd → ΔQ 4629 bis 5657 kWh/a
//   JAZ 3 bis 4: kleinstes ΔStrom = 4628,6 / 4 = 1157,1 kWh/a, größtes = 5657,1 / 3 = 1885,7 kWh/a
//   Preis 25 bis 35 ct/kWh: kleinste Kosten = 1157,1 · 0,25 = 289,3 €/a, größte = 1885,7 · 0,35 = 660,0 €/a
test('Jahreswärme: Bandbreiten von ΔΦ, JAZ und Strompreis werden durchgereicht (kleinster bis größter Wert)', () => {
  const r = berechneJahreswaerme({ deltaPhi: { min: 1800, max: 2200 }, thetaMittel: 20, thetaAussen: -8, gradtage: 3000, jaz: { min: 3, max: 4 }, strompreis: { min: 25, max: 35 } });
  gleich(r.deltaH.min, 64.2857, 1e-4, 'ΔH min'); gleich(r.deltaH.max, 78.5714, 1e-4, 'ΔH max');
  gleich(r.deltaQ.min, 4628.571, 1e-3, 'ΔQ min'); gleich(r.deltaQ.max, 5657.143, 1e-3, 'ΔQ max');
  gleich(r.deltaStrom.min, 1157.143, 1e-3, 'ΔStrom min = ΔQ min / JAZ max'); gleich(r.deltaStrom.max, 1885.714, 1e-3, 'ΔStrom max = ΔQ max / JAZ min');
  gleich(r.kosten.min, 289.286, 1e-3, 'Kosten min'); gleich(r.kosten.max, 660, 1e-9, 'Kosten max');
  // Mehrbedarf (negatives ΔΦ): die Reihenfolge der Grenzen bleibt richtig
  const mehr = berechneJahreswaerme({ deltaPhi: { min: -400, max: -200 }, thetaMittel: 20, thetaAussen: -8, gradtage: 3000, jaz: { min: 3, max: 4 }, strompreis: { min: 25, max: 35 } });
  wahr(mehr.deltaStrom.min <= mehr.deltaStrom.max && mehr.kosten.min <= mehr.kosten.max && mehr.kosten.max < 0, 'negative Werte: min ≤ max');
});

test('Jahreswärme: ohne Gradtagzahl nur ΔH, ohne JAZ keine Stromrechnung, ungültige Temperatur wird gemeldet', () => {
  const basis = { deltaPhi: { min: 2000, max: 2000 }, thetaMittel: 20, thetaAussen: -8, jaz: { min: null, max: null }, strompreis: { min: 30, max: 30 } };
  const ohneG = berechneJahreswaerme({ ...basis, gradtage: null });
  wahr(ohneG.deltaH && ohneG.deltaQ === null && ohneG.grund === 'Gradtagzahl G fehlt', 'ohne G kein ΔQ');
  const ohneJaz = berechneJahreswaerme({ ...basis, gradtage: 3000 });
  wahr(ohneJaz.deltaQ && ohneJaz.deltaStrom === null && ohneJaz.kosten === null, 'ohne JAZ keine Stromwerte');
  const mitJazOhnePreis = berechneJahreswaerme({ ...basis, gradtage: 3000, jaz: { min: 3.5, max: 3.5 }, strompreis: { min: null, max: null } });
  wahr(mitJazOhnePreis.deltaStrom && mitJazOhnePreis.kosten === null, 'ohne Preis keine Kosten');
  wahr(berechneJahreswaerme({ ...basis, thetaMittel: -10, gradtage: 3000 }).grund.includes('nicht über der Normaußentemperatur'), 'θ_soll unter θ_e');
  wahr(berechneJahreswaerme({ ...basis, deltaPhi: null, gradtage: 3000 }).grund === 'Heizlast nicht berechenbar', 'ohne Heizlast');
});

// Mini-Haus: Dach U 1,0 → 0,20 mindert um 224 W, θ_soll 20 °C, θ_e −8 °C → ΔH = 224 / 28 = 8,00 W/K
//   G = 3000 Kd (manuell): ΔQ = 8 · 24 · 3000 / 1000 = 576 kWh/a;  JAZ 3,5: 164,57 kWh/a;  30 ct/kWh: 49,37 €/a
test('Jahreswärme im Vergleich: Dach-Szenario (224 W) → ΔH 8,00 W/K, ΔQ 576 kWh/a, 164,6 kWh Strom, 49,4 €/a', () => {
  const ist = mini();
  ist.einstellungen.vergleich = { gradtage: { quelle: 'manuell', verbrauchId: null, manuell: 3000 }, jaz: { min: 3.5, max: 3.5 }, strompreis: { min: 30, max: 30 } };
  const sz = neuesSzenario('s', 'Dach gedämmt');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  const v = baueVergleich(ist, [sz]);
  const j = v.spalten[1].jahr;
  gleich(j.deltaPhi.min, 224, 1e-9, 'ΔΦ'); gleich(j.deltaH.min, 8, 1e-9, 'ΔH = 224 / 28'); gleich(j.deltaQ.min, 576, 1e-9, 'ΔQ = 8 · 24 · 3000 / 1000');
  gleich(j.deltaStrom.min, 164.5714, 1e-4, 'ΔStrom = 576 / 3,5'); gleich(j.kosten.min, 49.3714, 1e-4, '49,37 €/a');
  const t = vergleichTabellen(v).jahreswaerme;
  wahr(t.kopf.join() === 'Kennzahl (Minderung gegenüber dem Ist-Zustand, negativ = Mehrbedarf),Dach gedämmt', t.kopf.join());
  const zelle = (name) => t.zeilen.find((z) => z[0].startsWith(name))[1];
  wahr(zelle('Minderung der Gebäudeheizlast') === '224 W' && zelle('Minderung des Wärmeverlusts') === '8,00 W/K' && zelle('Wärmeminderung') === '576 kWh/a', `${zelle('Minderung des Wärmeverlusts')} | ${zelle('Wärmeminderung')}`);
  wahr(zelle('Stromminderung') === '165 kWh/a' && zelle('Stromkosten-Minderung') === '49,4 €/a', `${zelle('Stromminderung')} | ${zelle('Stromkosten-Minderung')}`);
  wahr(t.hinweis === JAHRESHINWEIS && JAHRESHINWEIS === 'Schätzung aus der Heizlast, Fremdwärme und Nutzerverhalten nicht berücksichtigt.', 'Pflichthinweis im Wortlaut');
  wahr(t.annahmen.some((x) => x.includes('θ_soll,Mittel = 20 °C')) && t.annahmen.some((x) => x.includes('3000 Kd (manuell')) && t.annahmen.some((x) => x.includes('Strompreis: 30 ct/kWh')), t.annahmen.join(' | '));
});

// Beispielhaus: θ_soll,Mittel = (20 · 20 + 22 · 6 + 15 · 8) / (20 + 6 + 8) = 652 / 34 = 19,176 °C (Wohnzimmer, Bad, passiver Flur)
//   G aus dem Verbrauchsdatensatz: G20/15 = 2450 Kd, 140 Heiztage → G = 2450 − (20 − 19,176) · 140 = 2334,7 Kd
test('Jahreswärme: G aus dem Verbrauchsdatensatz (Summe der Heizmonate, umgerechnet auf θ_soll,Mittel 19,18 °C) = 2334,7 Kd', async () => {
  const ist = await beispiel();
  ist.einstellungen.vergleich = { gradtage: { quelle: 'verbrauch', verbrauchId: 'vb-beispiel', manuell: null }, jaz: { min: 3, max: 4 }, strompreis: { min: 28, max: 34 } };
  const sz = neuesSzenario('s', 'Dach gedämmt');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  const v = baueVergleich(ist, [sz]);
  gleich(v.thetaMittel, 652 / 34, 1e-12, 'θ_soll,Mittel');
  gleich(v.gradtage.g, 2450 - (20 - 652 / 34) * 140, 1e-9, 'G aus dem Datensatz');
  wahr(Math.abs(v.gradtage.g - 2334.7) < 0.05 && v.gradtage.text.includes('Heizperiode 2024/25 (fiktiv)'), v.gradtage.text);
  const j = v.spalten[1].jahr;
  const dg = v.spalten[0].ergebnis.gebaeude.guenstig.summe - v.spalten[1].ergebnis.gebaeude.guenstig.summe;
  const du = v.spalten[0].ergebnis.gebaeude.ungunstig.summe - v.spalten[1].ergebnis.gebaeude.ungunstig.summe;
  gleich(j.deltaPhi.min, Math.min(dg, du), 1e-9, 'ΔΦ min aus günstig/ungünstig'); gleich(j.deltaPhi.max, Math.max(dg, du), 1e-9, 'ΔΦ max');
  gleich(j.deltaH.min, j.deltaPhi.min / (652 / 34 + 8), 1e-9, 'ΔH = ΔΦ / (θ_soll,Mittel − θ_e)');
  gleich(j.deltaQ.max, (j.deltaH.max * 24 * v.gradtage.g) / 1000, 1e-9, 'ΔQ = ΔH · 24 · G / 1000');
  wahr(j.deltaPhi.min < j.deltaPhi.max && j.deltaQ.min < j.deltaQ.max && j.kosten.min < j.kosten.max, 'echte Bandbreiten');
  // Ohne Verbrauchsdatensatz fehlt G
  ist.einstellungen.vergleich.gradtage.verbrauchId = null;
  const ohne = baueVergleich(ist, [sz]);
  wahr(ohne.gradtage.g === null && ohne.spalten[1].jahr.deltaQ === null && vergleichTabellen(ohne).jahreswaerme.zeilen.find((z) => z[0].startsWith('Wärmeminderung'))[1].includes('Gradtagzahl G fehlt'), 'ohne Datensatz: G fehlt');
  // Annahmen: Vorgaben bei fehlenden Einstellungen
  const a = vergleichsannahmen({});
  wahr(a.gradtage.quelle === 'verbrauch' && a.jaz.min === null && a.strompreis.max === null, 'Vorgaben');
  wahr(loeseGradtageAuf([], vergleichsannahmen({ vergleich: { gradtage: { quelle: 'manuell', manuell: 2500 } } }), 20).g === 2500, 'manuell');
});

// --- Auslegungswert und Kosten im Vergleich ---------------------------------------------------------------

test('Vergleich: „Auslegungswert Wärmepumpe (obere Grenze)“ ist die obere Grenze der Gebäudeheizlast und hervorgehoben', async () => {
  const ist = await beispiel();
  const sz = neuesSzenario('s', 'Dach gedämmt');
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  sz.kosten = { investition: { min: 8000, max: 12000 }, foerderung: { min: 2000, max: 3000 }, quelle: 'Angebot Dachdecker vom 01.10.2026' };
  const v = baueVergleich(ist, [sz]);
  const t = vergleichTabellen(v).kennzahlen;
  wahr(AUSLEGUNGSWERT === 'Auslegungswert Wärmepumpe (obere Grenze)', 'Beschriftung');
  const index = t.zeilen.findIndex((z) => z[0] === AUSLEGUNGSWERT);
  wahr(index === 1 && t.hervor.includes(index), 'zweite Zeile, hervorgehoben');
  wahr(t.zeilen[index][1] === '3816 W', `Ist: ${t.zeilen[index][1]}`);
  gleich(Number.parseFloat(t.zeilen[index][2]), Math.round(v.spalten[1].bandbreite.max), 1, 'Szenario: obere Grenze');
  wahr(v.spalten[1].bandbreite.max < v.spalten[0].bandbreite.max, 'das Szenario senkt den Auslegungswert');
  const zeile = (name) => t.zeilen.find((z) => z[0].startsWith(name));
  wahr(zeile('Investitionskosten')[1] === '–' && zeile('Investitionskosten')[2] === '8000 – 12000 €', zeile('Investitionskosten').join(' | '));
  wahr(zeile('Förderung')[2] === '2000 – 3000 €' && zeile('Kosten nach Förderung')[2] === '5000 – 10000 €', 'Förderung und Kosten nach Förderung');
  wahr(zeile('Quelle der Kosten')[2] === 'Angebot Dachdecker vom 01.10.2026', 'Quelle');
  const reihenfolge = t.zeilen.map((z) => z[0]);
  wahr(reihenfolge.indexOf('Gebäudeheizlast, Mittelwert') < reihenfolge.findIndex((x) => x.startsWith('Minderung')) && reihenfolge.findIndex((x) => x.startsWith('Minderung')) < reihenfolge.findIndex((x) => x.startsWith('Kosten nach Förderung')), 'Kosten stehen neben Heizlast und Minderung');
  // ohne Kosten steht „–“
  const ohne = vergleichTabellen(baueVergleich(ist, [neuesSzenario('o', 'Ohne')])).kennzahlen;
  wahr(ohne.zeilen.find((z) => z[0].startsWith('Kosten nach Förderung'))[2] === '–', 'ohne Eingabe „–“');
});

test('Export und Import erhalten Kosten und Vergleichsannahmen; der Bericht zeigt Auslegungswert, Jahreswärme und Kosten', async () => {
  const text = await ladeText();
  const speicher = pruefeImport(text).daten;
  speicher.settings[0].vergleich = { gradtage: { quelle: 'manuell', verbrauchId: null, manuell: 2800 }, jaz: { min: 3, max: 3.5 }, strompreis: { min: 28, max: 32 } };
  const sz = neuesSzenario('s1', 'Dach gedämmt', jetzt);
  sz.abweichungen.bauteile['bt-dach'] = { name: 'Flachdach', u: { min: 0.2, max: 0.2 } };
  sz.kosten = { investition: { min: 8000, max: 12000 }, foerderung: { min: 2000, max: 3000 }, quelle: 'Angebot Dachdecker' };
  speicher.scenarios = [sz];
  const zurueck = pruefeImport(JSON.stringify(baueExport(speicher, jetzt)));
  wahr(zurueck.ok, 'Import');
  wahr(JSON.stringify(zurueck.daten.scenarios[0].kosten) === JSON.stringify(sz.kosten), 'Kosten bleiben erhalten');
  wahr(JSON.stringify(zurueck.daten.settings[0].vergleich) === JSON.stringify(speicher.settings[0].vergleich), 'Vergleichsannahmen bleiben erhalten');

  const ist = projektAusSpeicher(zurueck.daten);
  const b = baueVergleichsBericht(ist, zurueck.daten.scenarios, jetzt);
  const json = JSON.stringify(b);
  wahr(json.includes('Auslegungswert Wärmepumpe (obere Grenze)') && json.includes(JAHRESHINWEIS), 'Auslegungswert und Pflichthinweis im Bericht');
  const kennzahlen = b.abschnitte.flatMap((x) => x.bloecke).find((x) => x.art === 'tabelle');
  wahr(kennzahlen.hervor.includes(1) && kennzahlen.zeilen[1][0] === AUSLEGUNGSWERT, 'Zeile im Bericht hervorgehoben');
  wahr(json.includes('Wärmeminderung ΔQ pro Jahr') && json.includes('Stromkosten-Minderung pro Jahr') && json.includes('2800 Kd (manuell'), 'Jahreswärme mit Annahmen');
  wahr(json.includes('5000 – 10000 €') && json.includes('Angebot Dachdecker'), 'Kosten im Bericht');
  const einzel = baueBericht(wendeSzenarioAn(ist, zurueck.daten.scenarios[0]).projekt, jetzt, { szenario: szenarioInfo(ist, zurueck.daten.scenarios[0]) });
  wahr(JSON.stringify(einzel).includes('Kosten nach Förderung') && JSON.stringify(einzel).includes('5000 – 10000 €'), 'Kosten im Bericht für das einzelne Szenario');
});
