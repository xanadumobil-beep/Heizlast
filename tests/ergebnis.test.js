// Tests für den Bereich „Ergebnis“: Sperrzeit-Zuschlag, Heizlastlinie, Datenqualität, Vorlauf-Text, Bericht, Export.
// Die Handrechnungen stehen als Kommentar bei den Tests.

import { test, wahr, gleich } from './runner.js';
import { pruefeImport, baueExport } from '../js/io.js';
import {
  sperrzeitZuschlag, zuschlaege, heizlastLinie, datenqualitaet, baueErgebnis, benoetigtText, waermepumpenannahmen,
  AUSSENTEMPERATUREN, TYPEN_HINWEIS, MILD_HINWEIS, UNVOLLSTAENDIG_TEXT,
} from '../js/ergebnis.js';
import { baueBericht } from '../js/bericht.js';

// Ein Raum, ein Flachdach (Handrechnung wie in szenario.test.js):
//   Dach 10 m² · (1,0 + 0,10) · 28 K = 308 W, Lüftung 0,34 · 0,5 · 25 m³ · 28 K = 119 W, zusammen 427 W
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
  fotoInfos: [],
  markierungen: [],
});
const heizkoerper = (extra = {}) => ({
  id: 'hk', raumId: 'r', bauart: 'platten', typ: '22', status: 'bleibt', material: 'stahl', ventil: 'neu', name: 'Platte',
  normleistung: 1000, normVorlauf: 75, normRuecklauf: 65, normRaum: 20, exponent: null, kennlinie: [], kennlinieRaumtemperatur: 20, notiz: '', ...extra,
});

// Sperrzeit: Die Wärme eines Tages (24 h · 8 kW) muss in 22 h geliefert werden.
//   Leistung = 8 kW · 24 / (24 − 2) = 8 · 24 / 22 = 8,7273 kW, Zuschlag = 8,7273 − 8 = 0,7273 kW
test('Sperrzeit-Zuschlag: 8 kW und 2 h Sperre ergeben 8,727 kW', () => {
  gleich(sperrzeitZuschlag(8000, 2), 727.2727, 1e-3, 'Zuschlag');
  gleich(8000 + sperrzeitZuschlag(8000, 2), 8727.2727, 1e-3, 'Summe');
  gleich(sperrzeitZuschlag(8000, 0), 0, 0, 'ohne Sperre kein Zuschlag');
  const liste = zuschlaege(8000, { sperrstunden: 2 });
  wahr(liste.length === 1 && liste[0].id === 'sperrzeit', 'ein Zuschlag');
  wahr(liste[0].begruendung.includes('2 h') && liste[0].begruendung.includes('22 h'), liste[0].begruendung);
  wahr(zuschlaege(8000, { sperrstunden: 0 }).length === 0, 'standardmäßig kein Zuschlag');
});

test('Sperrstunden: ungültige Werte werden nicht übernommen, Standard ist 0', () => {
  wahr(waermepumpenannahmen({}).sperrstunden === 0, 'fehlt');
  wahr(waermepumpenannahmen({ waermepumpe: { sperrstunden: 2.5 } }).sperrstunden === 2.5, '2,5 h');
  wahr(waermepumpenannahmen({ waermepumpe: { sperrstunden: 24 } }).ungueltig, '24 h ist ungültig');
  wahr(waermepumpenannahmen({ waermepumpe: { sperrstunden: -1 } }).ungueltig, 'negativ ist ungültig');
});

// Heizlastlinie: H = 300 W/K, θ_soll = 20 °C, Φ(θ) = H · (20 − θ)
//   −8 °C: 300 · 28 = 8400 W,  −5 °C: 300 · 25 = 7500 W,  −2 °C: 300 · 22 = 6600 W,
//   +2 °C: 300 · 18 = 5400 W,  +7 °C: 300 · 13 = 3900 W,  +12 °C: 300 · 8 = 2400 W
test('Heizlastlinie: H = 300 W/K, θ_soll 20 °C: 8,4 kW bei −8 °C und 3,9 kW bei +7 °C', () => {
  const l = heizlastLinie({ min: 8400, max: 8400 }, 20, -8);
  wahr(l.ok, 'berechenbar');
  gleich(l.hMin, 300, 1e-9, 'H');
  wahr(AUSSENTEMPERATUREN.join() === '-8,-5,-2,2,7,12', 'Stützpunkte');
  const bei = (t) => l.punkte.find((p) => p.theta === t);
  gleich(bei(-8).max, 8400, 1e-6, '−8 °C');
  gleich(bei(-5).max, 7500, 1e-6, '−5 °C');
  gleich(bei(-2).max, 6600, 1e-6, '−2 °C');
  gleich(bei(2).max, 5400, 1e-6, '+2 °C');
  gleich(bei(7).max, 3900, 1e-6, '+7 °C');
  gleich(bei(12).max, 2400, 1e-6, '+12 °C');
});

// Bandbreite: 7000 bis 8400 W bei −8 °C und θ_soll 20 °C → H = 250 bis 300 W/K; bei +7 °C: 13 K → 3250 bis 3900 W
test('Heizlastlinie: untere und obere Grenze je Punkt; ohne Soll-Temperatur nicht berechenbar', () => {
  const l = heizlastLinie({ min: 7000, max: 8400 }, 20, -8);
  gleich(l.hMin, 250, 1e-9, 'H untere Grenze');
  gleich(l.hMax, 300, 1e-9, 'H obere Grenze');
  const p7 = l.punkte.find((p) => p.theta === 7);
  gleich(p7.min, 3250, 1e-6, '+7 °C untere Grenze');
  gleich(p7.max, 3900, 1e-6, '+7 °C obere Grenze');
  wahr(!heizlastLinie({ min: 1, max: 2 }, null, -8).ok, 'ohne θ_soll');
  wahr(!heizlastLinie(null, 20, -8).ok, 'ohne Heizlast');
  wahr(!heizlastLinie({ min: 1, max: 2 }, -10, -8).ok, 'θ_soll unter θ_e');
  // Über der Soll-Temperatur gibt es keine Heizlast (nie negativ)
  gleich(heizlastLinie({ min: 8400, max: 8400 }, 10, -8, [12]).punkte[0].max, 0, 0, 'über θ_soll');
});

// Mini-Haus: 427 W bei −8 °C, θ_soll 20 °C → H = 427 / 28 = 15,25 W/K; bei +7 °C: 15,25 · 13 = 198,25 W.
// Mit 2 h Sperre: 427 · 24 / 22 = 465,818 W
test('Ergebnis Mini-Haus: obere Grenze, Linie und Sperrzeit-Zuschlag', () => {
  const p = mini();
  p.einstellungen.waermepumpe = { sperrstunden: 2 };
  const e = baueErgebnis(p);
  wahr(e.hatErgebnis, 'Ergebnis');
  gleich(e.obere, 427, 1e-9, 'obere Grenze');
  gleich(e.waermepumpe.gesamtW, 465.8182, 1e-3, 'mit Zuschlag');
  gleich(e.waermepumpe.zuschlaege[0].wert, 38.8182, 1e-3, '427 · 24/22 − 427');
  gleich(e.linie.punkte.find((x) => x.theta === 7).max, 198.25, 1e-9, '+7 °C');
  gleich(e.verluste.summe, 427, 1e-9, 'Summe der Verlustarten');
  const dach = e.verluste.zeilen.find((v) => v.id === 'dach');
  gleich(dach.w, 308, 1e-9, 'Dach');
  gleich(dach.prozent, (308 / 427) * 100, 1e-9, 'Anteil Dach');
  gleich(e.verluste.zeilen.find((v) => v.id === 'lueftung').w, 119, 1e-9, 'Lüftung');
  // Ohne Eingabe kein Zuschlag
  const ohne = baueErgebnis(mini());
  wahr(ohne.waermepumpe.zuschlaege.length === 0, 'kein Zuschlag ohne Eingabe');
  gleich(ohne.waermepumpe.gesamtW, 427, 1e-9, 'ohne Zuschlag');
});

test('Benötigt-Text: Leistung, Außentemperatur und Vorlauf; ohne Heizkörperleistung der Grund statt der Vorlauftemperatur', () => {
  const mit = mini();
  mit.heizkoerper = [heizkoerper()];
  const e = baueErgebnis(mit);
  wahr(e.waermepumpe.vorlauf.art === 'ok', `Vorlauf berechenbar: ${JSON.stringify(e.waermepumpe.vorlauf)}`);
  const t = benoetigtText(e);
  wahr(t.startsWith('Benötigt: 0,43 kW Heizleistung bei −8 °C Außentemperatur und '), t);
  wahr(t.endsWith(' °C Vorlauf'), t);

  const ohneLeistung = mini();
  ohneLeistung.heizkoerper = [heizkoerper({ normleistung: null })];
  const t2 = benoetigtText(baueErgebnis(ohneLeistung));
  wahr(t2.includes('Vorlauf nicht bestimmbar: Heizkörperleistung fehlt in Raum'), t2);
  wahr(!t2.includes('°C Vorlauf'), 'keine Vorlauftemperatur genannt');

  const keiner = benoetigtText(baueErgebnis(mini()));
  wahr(keiner.includes('Vorlauf nicht bestimmbar: Kein Heizkörper in Raum'), keiner);
});

test('Datenqualität: Ampel und Zähler', () => {
  // Mini-Haus hat kein Bodenelement: Vollständigkeitsprüfung meldet einen Fehler → rot
  const rot = datenqualitaet(mini());
  wahr(rot.ampel === 'rot' && rot.meldung === UNVOLLSTAENDIG_TEXT, `${rot.ampel} ${rot.meldung}`);
  wahr(rot.zaehler.raeumeMitLuecken === 1, 'ein Raum mit Lücken');

  const ohneMass = mini();
  ohneMass.flaechen.push({ id: 'g', raumId: 'r', bauteilId: 'bt-dach', angrenzend: { art: 'aussen' }, modus: 'masse', laenge: null, hoehe: 2.5, oeffnungen: [] });
  wahr(datenqualitaet(ohneMass).zaehler.flaechenOhneMass === 1, 'Fläche ohne Maß');

  const ohneLeistung = mini();
  ohneLeistung.heizkoerper = [heizkoerper({ normleistung: null })];
  wahr(datenqualitaet(ohneLeistung).zaehler.heizkoerperOhneLeistung === 1, 'Heizkörper ohne Leistung');

  const passiv = mini();
  passiv.raeume.push({ id: 'p', name: 'Flur', geschoss: 'EG', status: 'passiv', theta: 15, flaeche: 5, hoehe: 2.5, volumenManuell: null, luftwechsel: null, waermeLieferanten: [{ raumId: 'r', prozent: 60 }] });
  const q = datenqualitaet(passiv);
  wahr(q.zaehler.passiveVerteilung === 1, 'Verteilung 60 % statt 100 %');
  wahr(q.details.some((d) => d.text.includes('Flur') && d.text.includes('60,0 % statt 100 %')), JSON.stringify(q.details));

  // Vollständiger Raum: Boden und Dach vorhanden, Hülle, Maße, Heizkörper mit Leistung → grün
  const voll = mini();
  voll.bauteile.push({ id: 'bt-platte', name: 'Platte', art: 'bodenplatte', u: { min: 0.5, max: 0.5 }, aufbau: '', quelle: 'schaetzung' });
  voll.zonen = [{ id: 'zone-erdreich', name: 'Erdreich', art: 'erdreich', temperatur: { min: 8, max: 12 }, notiz: '' }];
  voll.flaechen.push({ id: 'b', raumId: 'r', bauteilId: 'bt-platte', angrenzend: { art: 'zone', zoneId: 'zone-erdreich' }, modus: 'flaeche', flaeche: 10, oeffnungen: [] });
  voll.heizkoerper = [heizkoerper()];
  const gruen = datenqualitaet(voll);
  wahr(gruen.ampel === 'gruen', `${gruen.ampel}: ${JSON.stringify(gruen.details)}`);
});

test('Bericht: Ergebnis steht auf der ersten Seite, mit Hinweisen, Datenqualität und Zuschlägen', () => {
  const p = mini();
  p.einstellungen.waermepumpe = { sperrstunden: 2 };
  const b = baueBericht(p, new Date(2026, 9, 24));
  const erste = b.abschnitte[0];
  wahr(erste.titel.includes('Ergebnis'), erste.titel);
  const json = JSON.stringify(erste);
  wahr(json.includes('Benötigt: 0,47 kW Heizleistung bei −8 °C Außentemperatur'), 'Benötigt-Text');
  wahr(json.includes('Sperrzeit des Netzbetreibers'), 'Zuschlag mit Begründung');
  wahr(json.includes(TYPEN_HINWEIS) && json.includes(MILD_HINWEIS), 'Hinweise');
  wahr(json.includes(UNVOLLSTAENDIG_TEXT), 'Datenqualität rot');
  wahr(json.includes('Heizlast bei verschiedenen Außentemperaturen') && json.includes('Aufteilung nach Verlustart'), 'Abschnitte');
});

test('Export und Import erhalten die Sperrstunden', () => {
  const speicher = pruefeImport(JSON.stringify(baueExport({ settings: [{ ...mini().einstellungen, id: 'projekt', waermepumpe: { sperrstunden: 2 } }] }, new Date(2026, 9, 24)))).daten;
  wahr(speicher.settings[0].waermepumpe.sperrstunden === 2, 'Sperrstunden nach Import');
});
