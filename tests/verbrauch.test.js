// Tests für den Verbrauchsabgleich. Die Handrechnungen stehen als Kommentar bei den Tests.

import { test, gleich, wahr } from './runner.js';
import {
  berechneVerbrauch, gradtage, vergleiche, annahmen, FREMDWAERME_HINWEIS, HS_HINWEIS,
} from '../js/engine/verbrauch.js';
import { mittlereInnentemperatur } from '../js/modell.js';

// Heizmonate (G20/15 in Kd | Heiztage): Oktober 250 | 20, November 450 | 30, Dezember 600 | 31,
// Januar 650 | 31, Februar 500 | 28. März (400 | 31) ist nicht als Heizmonat gewählt und zählt nicht.
//   Summe G20/15 = 250 + 450 + 600 + 650 + 500 = 2450 Kd
//   Summe Heiztage = 20 + 30 + 31 + 31 + 28 = 140
const monate = () => [
  { name: 'Oktober', gradtage: 250, heiztage: 20, heizmonat: true },
  { name: 'November', gradtage: 450, heiztage: 30, heizmonat: true },
  { name: 'Dezember', gradtage: 600, heiztage: 31, heizmonat: true },
  { name: 'Januar', gradtage: 650, heiztage: 31, heizmonat: true },
  { name: 'Februar', gradtage: 500, heiztage: 28, heizmonat: true },
  { name: 'März', gradtage: 400, heiztage: 31, heizmonat: false },
];

const eingabe = (extra = {}) => ({
  gasKwh: 20000,
  warmwasserKwh: 3000,
  kesselNutzungsgrad: { min: 90, max: 95 },
  holzRm: 4,
  heizwertRm: { min: 1800, max: 2000 },
  ofenWirkungsgrad: { min: 70, max: 80 },
  monate: monate(),
  innentemperatur: 21,
  normAussentemperatur: -8,
  ...extra,
});

// Gradtagzahl auf die mittlere Innentemperatur 21 °C umgerechnet:
//   G = G20/15 − (20 − θ_i) · Heiztage = 2450 − (20 − 21) · 140 = 2450 + 140 = 2590 Kd
test('Gradtage: nur gewählte Monate, Umrechnung auf die Innentemperatur', () => {
  const g = gradtage(monate(), 21);
  gleich(g.g20_15, 2450, 1e-9, 'Summe G20/15');
  gleich(g.heiztage, 140, 1e-9, 'Summe Heiztage');
  gleich(g.korrektur, -140, 1e-9, 'Korrektur');
  gleich(g.g, 2590, 1e-9, 'Gradtagzahl bei 21 °C');
  gleich(gradtage(monate(), 20).g, 2450, 1e-9, 'bei 20 °C keine Korrektur');
  gleich(gradtage(monate(), 19).g, 2310, 1e-9, 'bei 19 °C: 2450 − 1 · 140');
});

// Mit März als Heizmonat: G20/15 = 2450 + 400 = 2850 Kd, Heiztage = 140 + 31 = 171
//   G = 2850 − (20 − 21) · 171 = 2850 + 171 = 3021 Kd
test('Gradtage: ein zusätzlich gewählter Monat zählt, ein abgewählter nicht', () => {
  const mitMaerz = monate().map((m) => (m.name === 'März' ? { ...m, heizmonat: true } : m));
  gleich(gradtage(mitMaerz, 21).g, 3021, 1e-9, 'mit März');
  const ohneJanuar = monate().map((m) => (m.name === 'Januar' ? { ...m, heizmonat: false } : m));
  gleich(gradtage(ohneJanuar, 20).g20_15, 1800, 1e-9, 'ohne Januar: 2450 − 650');
});

// Gas: 20000 kWh − 3000 kWh Warmwasser = 17000 kWh Heizung
//   Nutzwärme Gas: 17000 · 0,90 = 15300 kWh bis 17000 · 0,95 = 16150 kWh
// Holz: 4 Rm
//   unten 4 · 1800 · 0,70 = 5040 kWh, oben 4 · 2000 · 0,80 = 6400 kWh
// Q = 15300 + 5040 = 20340 kWh bis 16150 + 6400 = 22550 kWh
// H = Q · 1000 / (24 · G), G = 2590 Kd, 24 · 2590 = 62160
//   unten 20 340 000 / 62 160 = 327,22 W/K, oben 22 550 000 / 62 160 = 362,77 W/K
// Φ_N = H · (21 − (−8)) = H · 29
//   unten 327,22 · 29 = 9489,4 W, oben 362,77 · 29 = 10 520,4 W, Mittel 10 004,9 W
test('Verbrauchsabgleich mit Gas und Holz: H und Heizlast als Bandbreite', () => {
  const r = berechneVerbrauch(eingabe());
  wahr(r.status === 'ok', `Status ok erwartet, war ${r.status}`);
  gleich(r.heizgasKwh, 17000, 1e-9, 'Gas für die Heizung');
  gleich(r.gasNutz.min, 15300, 1e-6, 'Nutzwärme Gas unten');
  gleich(r.gasNutz.max, 16150, 1e-6, 'Nutzwärme Gas oben');
  gleich(r.holzNutz.min, 5040, 1e-6, 'Nutzwärme Holz unten');
  gleich(r.holzNutz.max, 6400, 1e-6, 'Nutzwärme Holz oben');
  gleich(r.waerme.min, 20340, 1e-6, 'Q unten');
  gleich(r.waerme.max, 22550, 1e-6, 'Q oben');
  gleich(r.h.min, 327.22, 0.01, 'H unten');
  gleich(r.h.max, 362.77, 0.01, 'H oben');
  gleich(r.heizlast.min, 9489.4, 0.1, 'Heizlast unten');
  gleich(r.heizlast.max, 10520.4, 0.1, 'Heizlast oben');
  gleich(r.heizlast.mittel, 10004.9, 0.1, 'Heizlast Mittel');
});

// Nur Gas, kein Warmwasserabzug: Q = 1000 · 0,90 = 900 kWh bis 1000 · 0,92 = 920 kWh
//   H = 900 000 / 62 160 = 14,479 W/K bis 920 000 / 62 160 = 14,801 W/K
//   Φ_N = H · 29 = 419,9 W bis 429,2 W
test('Verbrauchsabgleich nur mit Gas: Holzangaben sind nicht nötig', () => {
  const r = berechneVerbrauch(eingabe({
    gasKwh: 1000, warmwasserKwh: 0, kesselNutzungsgrad: { min: 90, max: 92 },
    holzRm: null, heizwertRm: null, ofenWirkungsgrad: null,
  }));
  wahr(r.status === 'ok', 'Status ok');
  gleich(r.h.min, 14.479, 0.001, 'H unten');
  gleich(r.h.max, 14.801, 0.001, 'H oben');
  gleich(r.heizlast.min, 419.9, 0.1, 'Heizlast unten');
  gleich(r.heizlast.max, 429.2, 0.1, 'Heizlast oben');
});

// Ohne Umrechnung (θ_i = 20 °C): G = 2450 Kd, H = 20 340 000 / (24 · 2450) = 20 340 000 / 58 800 = 345,92 W/K
test('Innentemperatur 20 °C: keine Gradtagkorrektur', () => {
  const r = berechneVerbrauch(eingabe({ innentemperatur: 20 }));
  gleich(r.h.min, 345.92, 0.01, 'H unten bei 20 °C');
  gleich(r.deltaT, 28, 1e-9, 'ΔT = 20 − (−8)');
});

test('Warmwasser größer als der Gasverbrauch ist ein Fehler', () => {
  wahr(berechneVerbrauch(eingabe({ warmwasserKwh: 25000 })).grund === 'warmwasser_zu_gross', 'Warmwasser zu groß');
});

test('Holz ohne Heizwert oder Wirkungsgrad ist ein Fehler, ohne Holz nicht', () => {
  wahr(berechneVerbrauch(eingabe({ heizwertRm: null })).grund === 'holz_angaben_fehlen', 'ohne Heizwert');
  wahr(berechneVerbrauch(eingabe({ ofenWirkungsgrad: null })).grund === 'holz_angaben_fehlen', 'ohne Wirkungsgrad');
  wahr(berechneVerbrauch(eingabe({ holzRm: 0, heizwertRm: null, ofenWirkungsgrad: null })).status === 'ok', '0 Rm Holz');
});

// G20/15 = 100 Kd bei 10 Heiztagen und θ_i = 5 °C: G = 100 − (20 − 5) · 10 = 100 − 150 = −50 Kd, nicht positiv
test('Nicht positive Gradtagzahl wird als Fehler gemeldet statt negativ gerechnet', () => {
  const r = berechneVerbrauch(eingabe({ innentemperatur: 5, monate: [{ name: 'X', gradtage: 100, heiztage: 10, heizmonat: true }] }));
  wahr(r.status === 'fehler' && r.grund === 'gradtage_nicht_positiv', 'Fehler erwartet');
  gleich(r.gradtage.g, -50, 1e-9, 'G = −50');
});

test('Heizmonate: ohne Auswahl und mit unvollständigem Monat gibt es kein Ergebnis', () => {
  wahr(berechneVerbrauch(eingabe({ monate: monate().map((m) => ({ ...m, heizmonat: false })) })).grund === 'keine_heizmonate', 'keine Auswahl');
  const unvollstaendig = monate();
  unvollstaendig[0].gradtage = null;
  wahr(berechneVerbrauch(eingabe({ monate: unvollstaendig })).grund === 'monat_unvollstaendig', 'gewählter Monat ohne Gradtagzahl');
  const abgewaehlt = monate();
  abgewaehlt[5] = { name: 'Mai', gradtage: null, heiztage: null, heizmonat: false };
  wahr(berechneVerbrauch(eingabe({ monate: abgewaehlt })).status === 'ok', 'ein abgewählter leerer Monat stört nicht');
});

// Berechnet 9000 bis 10000 W (Mittel 9500 W), Verbrauch 9489,4 bis 10 520,4 W (Mittel 10 004,9 W)
//   Abweichung = (10 004,9 − 9500) / 9500 = +5,3 %, die Bereiche überlappen
test('Vergleich: Abweichung in Prozent über die Mittelwerte und Überlappung', () => {
  const v = vergleiche({ min: 9000, max: 10000 }, { min: 9489.4, max: 10520.4 });
  gleich(v.mittelBerechnet, 9500, 1e-9, 'Mittel berechnet');
  gleich(v.mittelVerbrauch, 10004.9, 1e-6, 'Mittel Verbrauch');
  gleich(v.abweichungProzent, 5.31, 0.01, 'Abweichung');
  wahr(v.ueberlappung === true, 'Bereiche überlappen');
  const weit = vergleiche({ min: 3000, max: 4000 }, { min: 9489.4, max: 10520.4 });
  wahr(weit.ueberlappung === false && weit.abweichungProzent > 100, 'weit auseinander, keine Überlappung');
  gleich(vergleiche({ min: 10000, max: 12000 }, { min: 8000, max: 9000 }).abweichungProzent, ((8500 - 11000) / 11000) * 100, 1e-9, 'negative Abweichung');
  wahr(vergleiche(null, { min: 1, max: 2 }) === null, 'ohne berechneten Wert kein Vergleich');
});

test('Annahmen führen alle Eingangswerte, Formeln und die beiden Pflichthinweise auf', () => {
  const e = eingabe();
  const text = annahmen(e, berechneVerbrauch(e)).join('\n');
  for (const erwartet of [
    'Oktober', 'Februar', '2450 Kd', '2590 Kd', '20000 kWh', '3000 kWh', '17000 kWh', '90,0 – 95,0 %',
    '4 Rm', '1800 – 2000 kWh/Rm', '70,0 – 80,0 %', '20340 – 22550 kWh', '327,2 – 362,8 W/K', '−8 °C'.replace('−', '-'),
    '9489 – 10520 W', HS_HINWEIS, FREMDWAERME_HINWEIS,
  ]) {
    wahr(text.includes(erwartet), `Annahmen enthalten "${erwartet}"`);
  }
  wahr(!text.includes('März'), 'der nicht gewählte Monat März wird nicht als Heizmonat aufgeführt');
});

test('Pflichthinweise haben den vorgegebenen Wortlaut', () => {
  wahr(
    FREMDWAERME_HINWEIS === 'Fremdwärme (Sonne, Personen, Geräte) ist im Verbrauch bereits abgezogen. '
      + 'Die aus dem Verbrauch abgeleitete Heizlast liegt deshalb eher zu niedrig.',
    'Fremdwärme-Hinweis',
  );
  wahr(HS_HINWEIS === 'bezogen auf Brennwert Hs, wie in der Gasrechnung', 'Hs-Hinweis');
});

// Flächengewichteter Mittelwert: (20 · 16 + 22 · 6 + 15 · 10) / (16 + 6 + 10) = (320 + 132 + 150) / 32 = 602 / 32 = 18,8125 °C
// Der unbeheizte Raum (5 °C, 100 m²) zählt nicht.
test('Mittlere Innentemperatur: flächengewichtet über beheizte und passive Räume', () => {
  const raeume = [
    { status: 'beheizt', theta: 20, flaeche: 16 },
    { status: 'beheizt', theta: 22, flaeche: 6 },
    { status: 'passiv', theta: 15, flaeche: 10 },
    { status: 'unbeheizt', theta: 5, flaeche: 100 },
  ];
  gleich(mittlereInnentemperatur(raeume), 18.8125, 1e-9, 'Mittelwert');
  wahr(mittlereInnentemperatur([{ status: 'unbeheizt', theta: 5, flaeche: 10 }]) === null, 'ohne beheizte Räume kein Vorschlag');
  wahr(mittlereInnentemperatur([{ status: 'beheizt', theta: 20, flaeche: null }]) === null, 'ohne Fläche kein Vorschlag');
});
