// Tests für den Berichtsinhalt: Zahlen, Abschnitte und Vollständigkeit am Beispielhaus.

import { test, wahr } from './runner.js';
import { baueBericht, HAFTUNGSHINWEIS } from '../js/bericht.js';
import { pruefeImport, projektAusSpeicher } from '../js/io.js';
import { rechne } from '../js/daten.js';
import { wattBereich, watt } from '../js/anzeige.js';

async function ladeBeispielText() {
  const adresse = new URL('../examples/beispiel-mini-haus.json', import.meta.url);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(adresse, 'utf8');
  }
  return (await fetch(adresse)).text();
}

const beispielProjekt = async () => projektAusSpeicher(pruefeImport(await ladeBeispielText()).daten);
const jetzt = new Date(2026, 9, 24);
const abschnitt = (bericht, name) => bericht.abschnitte.find((a) => a.titel.includes(name));
const tabellen = (a) => a.bloecke.filter((b) => b.art === 'tabelle');
// Nur die Textwerte (ohne JSON-Struktur, in der null als Feldwert vorkommen darf).
const alleTexte = (bericht) => {
  const texte = [];
  JSON.stringify(bericht, (_schluessel, wert) => { if (typeof wert === 'string') texte.push(wert); return wert; });
  return texte.join('\n');
};

// --- Aufbau ----------------------------------------------------------------------------------

test('Bericht: Kopf mit Projektname, Datum und Haftungshinweis', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  wahr(b.projektname === 'Beispielhaus (fiktiv)' && b.erstelltAm === '24.10.2026', 'Projekt und Datum');
  wahr(b.haftungshinweis === HAFTUNGSHINWEIS && b.haftungshinweis.includes('ersetzt keine offizielle Heizlastberechnung'), 'Haftungshinweis');
  wahr(b.seitentitel === 'Heizlast-Bericht Beispielhaus (fiktiv) 2026-10-24', `Seitentitel (Dateiname der PDF): ${b.seitentitel}`);
});

test('Bericht: alle geforderten Abschnitte, durchnummeriert', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const titel = b.abschnitte.map((a) => a.titel);
  for (const erwartet of [
    'Ergebnis auf einen Blick', 'Projektdaten', 'Verfahren und Annahmen', 'Zonen', 'Bauteilkatalog', 'Öffnungstypen',
    'Räume und Heizlast', 'Heizkörper', 'Vorlauftemperaturen', 'Verbrauchsabgleich', 'Hinweise', 'Anlage: Raumflächen',
  ]) {
    wahr(titel.some((t) => t.includes(erwartet)), `Abschnitt „${erwartet}“ fehlt`);
  }
  wahr(titel.every((t, i) => t.startsWith(`${i + 1} `)), 'Nummerierung 1 bis n');
  wahr(abschnitt(b, 'Anlage').neueSeite === true, 'Die Anlage beginnt auf einer neuen Seite');
});

// --- Zahlen ------------------------------------------------------------------------------------

test('Bericht: Ergebnis auf einen Blick mit Gebäudeheizlast als Bandbreite, Vorlauf und Verbrauch', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const zeilen = abschnitt(b, 'Ergebnis').bloecke[0].zeilen;
  const wert = (name) => zeilen.find((z) => z[0].includes(name))?.[1] ?? '';
  wahr(wert('Gebäudeheizlast').startsWith('2332 – 3816 W') && wert('Gebäudeheizlast').includes('Mittel 3074 W'), `Gebäudeheizlast: ${wert('Gebäudeheizlast')}`);
  wahr(wert('Gegenprobe').startsWith('bestanden'), 'Gegenprobe bestanden');
  wahr(wert('Nötige Vorlauftemperatur').startsWith('56,1 °C') && wert('Nötige Vorlauftemperatur').includes('„Bad“'), `Vorlauf: ${wert('Nötige Vorlauftemperatur')}`);
  wahr(wert('Ziel-Vorlauftemperatur').startsWith('55 °C'), 'Ziel-Vorlauftemperatur');
  wahr(wert('Verbrauchsabgleich').includes('3001 – 3719 W') && wert('Verbrauchsabgleich').includes('+9,3 %'), `Verbrauch: ${wert('Verbrauchsabgleich')}`);
});

test('Bericht: Raumtabelle enthält jeden Raum mit Heizlast als Bandbreite, Raum-zu-Raum und passivem Anteil', async () => {
  const projekt = await beispielProjekt();
  const b = baueBericht(projekt, jetzt);
  const t = tabellen(abschnitt(b, 'Räume und Heizlast'))[0];
  wahr(t.kopf.includes('davon Raum-zu-Raum (W)') && t.kopf.includes('davon passiv (W)') && t.kopf.includes('Heizlast (W)'), 'Spaltenköpfe');
  wahr(t.zeilen.length === 4 && t.zeilen[3][0] === 'Gebäude gesamt' && t.summenzeile === true, 'drei Räume und die Gebäudezeile');
  const { ergebnis } = rechne(projekt);
  for (const r of ergebnis.raeume) {
    const zeile = t.zeilen.find((z) => z[0] === r.name);
    const erwartet = r.status === 'passiv' ? wattBereich(r.guenstig.netto, r.ungunstig.netto) : wattBereich(r.guenstig.heizlast, r.ungunstig.heizlast);
    wahr(zeile[7].startsWith(erwartet), `${r.name}: ${zeile[7]} statt ${erwartet}`);
  }
  const wohnen = t.zeilen.find((z) => z[0] === 'Wohnzimmer');
  const passiv = ergebnis.raeume.find((r) => r.name === 'Wohnzimmer');
  wahr(wohnen[10] === wattBereich(passiv.guenstig.zugeteilt, passiv.ungunstig.zugeteilt), 'Wohnzimmer: Anteil aus dem passiven Flur');
  wahr(t.zeilen.find((z) => z[0] === 'Bad')[9] !== '0 W', 'Bad: Raum-zu-Raum-Verlust ist angerechnet');
  wahr(t.zeilen[3][7] === wattBereich(ergebnis.gebaeude.guenstig.summe, ergebnis.gebaeude.ungunstig.summe), 'Gebäudezeile = Gebäudeheizlast');
});

test('Bericht: Gegenprobe, Wärmelieferanten und angerechnete Raum-zu-Raum-Verluste', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const a = abschnitt(b, 'Räume und Heizlast');
  const gegenprobe = tabellen(a).find((t) => t.kopf[1] === 'günstig (W)');
  wahr(gegenprobe && gegenprobe.zeilen.at(-1)[0] === 'Differenz' && gegenprobe.zeilen.at(-1)[1] === '0,0', 'Differenz 0,0 W');
  wahr(JSON.stringify(a).includes('Flur: Wohnzimmer 60 %, Bad 40 %'), 'Wärmelieferanten des Flurs');
  const rzr = tabellen(a).find((t) => t.kopf[0] === 'Raum' && t.kopf[2] === 'an Raum');
  wahr(rzr && rzr.zeilen.length >= 1 && rzr.zeilen[0][0] === 'Bad', 'Raum-zu-Raum-Verlust des Bades');
});

test('Bericht: Heizkörpertabelle mit Leistung, Bedingungen, Glieder und Kennlinie', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const t = tabellen(abschnitt(b, 'Heizkörper'))[0];
  wahr(t.zeilen.length === 4, 'vier Heizkörper');
  const text = JSON.stringify(t.zeilen);
  wahr(text.includes('1450 W bei 55/45/20 °C'), 'Plattenheizkörper mit Normbedingungen');
  wahr(text.includes('1800 W bei 90/70/20 °C (12 Glieder × 150 W)'), 'Gliederheizkörper: Glieder × Leistung je Glied');
  wahr(text.includes('Kennlinie: 3 Wertepaare'), 'Wärmepumpen-Heizkörper mit Kennlinie');
  wahr(t.zeilen.some((z) => z[2] === 'Entfällt') && t.zeilen.some((z) => z[4] === 'Altes Ventil'), 'Status und Ventil');
});

test('Bericht: Vorlauftemperaturen mit bestimmendem Raum, Deckung und Hinweisen', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const a = abschnitt(b, 'Vorlauftemperaturen');
  const t = tabellen(a)[0];
  wahr(t.kopf.includes('Installiert bei 55 °C (W)') && t.kopf.includes('Deckung') && t.kopf.includes('Nötiger Vorlauf ungünstig'), 'Spaltenköpfe');
  wahr(t.zeilen.length === 2 && t.zeilen.some((z) => z[0] === 'Bad (bestimmender Raum)' && z[7] === '56,1 °C'), 'Bad ist bestimmend bei 56,1 °C');
  wahr(JSON.stringify(a).includes('Altes Ventil'), 'Hinweis altes Ventil');
});

test('Bericht: Verbrauchsabgleich mit Vergleich, Fremdwärme-Hinweis und allen Annahmen', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const a = abschnitt(b, 'Verbrauchsabgleich');
  const text = JSON.stringify(a);
  wahr(text.includes('3001 – 3719') && text.includes('Berechnet aus den Räumen') && text.includes('+9,3 %'), 'Vergleich neben der berechneten Heizlast');
  wahr(a.bloecke.some((x) => x.art === 'box' && x.text.startsWith('Fremdwärme (Sonne, Personen, Geräte) ist im Verbrauch bereits abgezogen.')), 'Fremdwärme-Hinweis');
  wahr(text.includes('bezogen auf Brennwert Hs, wie in der Gasrechnung') && text.includes('θ_ist') && text.includes('θ_soll') && text.includes('Unterer Wert'), 'Annahmen: Hs, θ_ist, θ_soll, Bandbreitenrichtung');
  wahr(text.includes('nicht für Heizung (Warmwasser, Gasherd, Sonstiges)'), 'Feldname „nicht für Heizung“');
});

test('Bericht: Verfahren nennt Bandbreite, ΔU_WB, Raum-zu-Raum, passive Räume und Vorlaufbestimmung', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const text = JSON.stringify(abschnitt(b, 'Verfahren und Annahmen'));
  for (const erwartet of [
    'DIN EN 12831-1', 'Bandbreite: Jede Berechnung läuft zweimal', '0,05 – 0,15', 'nur auf Bauteile der Gebäudehülle', 'Raum-zu-Raum',
    'Passive Räume', 'Gegenprobe', 'keine Extrapolation', 'Alte Ventile sind nur ein Hinweis', 'zwischen 25 und 75',
  ]) {
    wahr(text.includes(erwartet), `Verfahren enthält „${erwartet}“`);
  }
});

test('Bericht: Anlage listet alle 14 Raumflächen mit Verlust', async () => {
  const b = baueBericht(await beispielProjekt(), jetzt);
  const a = abschnitt(b, 'Anlage');
  const zeilen = tabellen(a).flatMap((t) => t.zeilen);
  wahr(zeilen.length === 14, `14 Raumflächen erwartet, ${zeilen.length} gefunden`);
  wahr(a.bloecke.filter((x) => x.art === 'zwischentitel').length === 3, 'ein Zwischentitel je Raum');
  wahr(zeilen.every((z) => /W$/.test(z[7])), 'jede Fläche mit Verlust in W');
  wahr(JSON.stringify(zeilen).includes('2 × Fenster 2-fach „Fenster Süd“ (4,48 m²)'), 'Öffnungen mit Anzahl und Fläche');
});

// --- Randfälle -----------------------------------------------------------------------------------

test('Bericht: kein „undefined“, „NaN“ oder „null“ im Text', async () => {
  const text = alleTexte(baueBericht(await beispielProjekt(), jetzt));
  wahr(!/undefined|NaN|(^|\n)null(\n|$)/.test(text), 'unerwarteter Platzhalter im Bericht');
});

test('Bericht: Hinweise nennen fehlende Leistung und markierte Eingaben', async () => {
  const projekt = await beispielProjekt();
  projekt.heizkoerper = projekt.heizkoerper.map((h) => (h.id === 'hk-bad-handtuch' ? { ...h, normleistung: null } : h));
  projekt.bauteile = projekt.bauteile.map((b) => (b.id === 'bt-dach' ? { ...b, u: { min: 7, max: 8 } } : b));
  const b = baueBericht(projekt, jetzt);
  const hinweise = JSON.stringify(abschnitt(b, 'Hinweise'));
  wahr(hinweise.includes('Leistung fehlt') && hinweise.includes('U-Wert'), 'Hinweise zu fehlender Leistung und unplausiblem U-Wert');
  const vorlauf = tabellen(abschnitt(b, 'Vorlauftemperaturen'))[0];
  wahr(vorlauf.zeilen.some((z) => z[0].startsWith('Bad') && z[7] === 'Leistung fehlt'), 'Bad: keine Vorlauftemperatur, „Leistung fehlt“');
  wahr(JSON.stringify(abschnitt(b, 'Ergebnis')).includes('Rangfolge unsicher'), 'Übersicht warnt vor unsicherer Rangfolge');
});

test('Bericht: leeres Projekt wirft keinen Fehler und lässt Ergebnisabschnitte weg', () => {
  const leer = {
    einstellungen: { projektname: '', thetaAussen: -8, luftwechselStandard: { min: 0.5, max: 1 }, dUWB: { min: 0.05, max: 0.15 }, fg: 1, aufheizzuschlag: { aktiv: false, wProM2: 0 }, spreizung: 5, heizkoerperExponent: 1.3, zielVorlauf: 45 },
    zonen: [], bauteile: [], oeffnungstypen: [], raeume: [], flaechen: [], heizkoerper: [], verbrauch: [],
  };
  const b = baueBericht(leer, jetzt);
  wahr(b.projektname === 'ohne Namen' && b.abschnitte.length >= 6, 'Bericht entsteht');
  wahr(JSON.stringify(abschnitt(b, 'Ergebnis')).includes('Es gibt noch keine berechenbaren Räume'), 'Hinweis auf fehlende Räume');
  wahr(!b.abschnitte.some((a) => a.titel.includes('Räume und Heizlast')), 'kein Raumabschnitt ohne Räume');
  wahr(!/undefined|NaN/.test(JSON.stringify(b)), 'keine Platzhalter');
});

test('Anzeigehilfen: Wattformate', () => {
  wahr(watt(3074.4) === '3074 W' && wattBereich(2332.2, 3815.8) === '2332 – 3816 W' && wattBereich(5.2, 5.3) === '5 W', 'Formate');
});
