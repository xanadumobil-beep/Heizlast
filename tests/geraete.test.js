// Tests für Wärmepumpen-Katalog und Geräteprüfung. Die Handrechnungen stehen als Kommentar bei den Tests.

import { test, wahr, gleich } from './runner.js';
import {
  interpoliere, maxLeistung, bivalenz, takt, effizienz, vorauswahl, fehlendeWerte, pruefeGeraet, pruefeListe, kontextAusErgebnis,
  heizkurve, schwellen, STANDARD_SCHWELLEN, BIVALENZ_HINWEIS,
} from '../js/geraete.js';
import { baueBericht } from '../js/bericht.js';
import { validiereEinstellungen, hatFehler } from '../js/validate.js';
import { heizlastLinie, baueErgebnis } from '../js/ergebnis.js';
import { validiereWaermepumpe } from '../js/validate.js';
import { neueWaermepumpe, normalisiereWaermepumpe } from '../js/schemas.js';
import { baueExport, baueKatalogExport, pruefeKatalogImport, pruefeImport, zusammenfassung } from '../js/io.js';

const geraet = (punkte, extra = {}) => ({ ...neueWaermepumpe(), hersteller: 'Test', modell: 'M', punkte, ...extra });
const P = (aussen, vorlauf, max, min = null, cop = null) => ({ aussen, vorlauf, max, min, cop });

// Interpolation über die Vorlauftemperatur: bei A−7 liegen 9,0 kW (W35) und 7,0 kW (W55) vor.
//   Steigung = (7,0 − 9,0) / (55 − 35) = −0,1 kW/K, bei Y = 50 °C: 9,0 − 0,1 · 15 = 7,5 kW
//   Y = 58 °C (3 K über W55): 7,0 − 0,1 · 3 = 6,7 kW; Y = 59 °C: mehr als 3 K, nicht berechenbar
test('Interpolation: A−7/W35 = 9,0 kW und W55 = 7,0 kW ergeben bei Y = 50 °C 7,5 kW', () => {
  const g = geraet([P(-7, 35, 9), P(-7, 55, 7)]);
  gleich(maxLeistung(g, -7, 50).kW, 7.5, 1e-9, 'Y = 50');
  gleich(maxLeistung(g, -7, 35).kW, 9, 1e-9, 'Y = 35');
  wahr(maxLeistung(g, -7, 50).extrapoliert === false, 'keine Extrapolation');
  gleich(maxLeistung(g, -7, 58).kW, 6.7, 1e-9, 'Y = 58 (3 K Extrapolation)');
  wahr(maxLeistung(g, -7, 58).extrapoliert === true, 'Extrapolation gekennzeichnet');
  wahr(!maxLeistung(g, -7, 59).ok && maxLeistung(g, -7, 59).grund === 'Datenblattpunkte reichen nicht', 'über 3 K hinaus');
  wahr(!maxLeistung(g, -8, 50).ok, 'bei nur einer Außentemperatur lässt sich nicht über die Außentemperatur fortsetzen');
});

// Zusätzlich A2/W50 = 9,5 kW. Bei Y = 50 °C: A−7 → 7,5 kW (siehe oben), A2 → 9,5 kW. Über die Außentemperatur:
//   Steigung = (9,5 − 7,5) / (2 − (−7)) = 2/9 = 0,2222 kW/K
//   −2,5 °C: 7,5 + 0,2222 · 4,5 = 8,5 kW (interpoliert)
//   −8 °C:   7,5 − 0,2222 · 1 = 7,2778 kW (1 K extrapoliert)
//   −10 °C:  7,5 − 0,2222 · 3 = 6,8333 kW (3 K, noch erlaubt); −10,01 °C: nicht mehr
//   +5 °C:   9,5 + 0,2222 · 3 = 10,1667 kW (3 K über +2 °C)
test('Interpolation über die Außentemperatur: A2/W50 = 9,5 kW, bei −8 °C 1 K extrapoliert, höchstens 3 K', () => {
  const g = geraet([P(-7, 35, 9), P(-7, 55, 7), P(2, 50, 9.5)]);
  gleich(maxLeistung(g, 2, 50).kW, 9.5, 1e-9, 'A2');
  gleich(maxLeistung(g, -2.5, 50).kW, 8.5, 1e-9, '−2,5 °C');
  const bei8 = maxLeistung(g, -8, 50);
  gleich(bei8.kW, 7.5 - 2 / 9, 1e-9, '−8 °C');
  wahr(bei8.extrapoliert, '−8 °C ist extrapoliert');
  gleich(maxLeistung(g, -10, 50).kW, 7.5 - 6 / 9, 1e-9, '−10 °C');
  wahr(!maxLeistung(g, -10.01, 50).ok, 'unter −10 °C reichen die Punkte nicht');
  gleich(maxLeistung(g, 5, 50).kW, 9.5 + 6 / 9, 1e-9, '+5 °C');
  wahr(!maxLeistung(g, 5.5, 50).ok, 'über +5 °C reichen die Punkte nicht');
  wahr(interpoliere([], 3).ok === false, 'ohne Punkte');
});

// Bivalenzpunkt. Heizlast 8,4 kW bei −8 °C, H = 300 W/K, θ_soll = 20 °C: Last(θ) = 0,3 · (20 − θ) kW.
// Gerät bei Y = 50 °C: 7,5 kW bei −7 °C, 9,5 kW bei +2 °C, Kennlinie P(θ) = 7,5 + (2/9) · (θ + 7).
//   P = Last:  7,5 + 14/9 + (2/9) θ = 6 − 0,3 θ   →   (2/9 + 3/10) θ = 6 − 7,5 − 14/9
//   (47/90) θ = −55/18   →   θ = −(55/18) · (90/47) = −275/47 = −5,851 °C
//   Kontrolle: Last = 0,3 · 25,851 = 7,755 kW, P = 7,5 + 0,2222 · 1,149 = 7,755 kW
//   Heizstab bei −8 °C: Last 8,4 kW − P(−8) = 8,4 − 7,2778 = 1,1222 kW
test('Bivalenzpunkt: Schnittpunkt von 7,5 kW bei −7 °C und 9,5 kW bei +2 °C mit der Heizlastlinie bei −5,85 °C', () => {
  const linie = heizlastLinie({ min: 8400, max: 8400 }, 20, -8);
  const g = geraet([P(-7, 50, 7.5), P(2, 50, 9.5)]);
  const b = bivalenz(g, 50, linie, -8);
  wahr(b.ok && b.art === 'punkt', JSON.stringify(b));
  gleich(b.theta, -275 / 47, 1e-9, 'Bivalenzpunkt');
  gleich(b.theta, -5.851, 1e-3, 'Bivalenzpunkt in °C');
  gleich(b.heizstab, 8.4 - (7.5 - 2 / 9), 1e-9, 'Heizstab bei −8 °C');
  gleich(b.heizstab, 1.1222, 1e-4, 'Heizstab in kW');
  // Ein stärkeres Gerät (9,0 kW bei −7 °C, 10,5 kW bei +2 °C) deckt −8 °C: P(−8) = 9,0 − 0,1667 = 8,833 kW ≥ 8,4 kW
  const stark = bivalenz(geraet([P(-7, 50, 9), P(2, 50, 10.5)]), 50, linie, -8);
  wahr(stark.art === 'kein_heizstab' && stark.heizstab === 0, 'kein Heizstab nötig');
  // Ein schwaches Gerät (4 kW, 5 kW) erreicht die Linie nicht: P(+2) = 5 kW < 5,4 kW, bis +5 °C: 5,33 kW < 4,5 kW? Last(5) = 4,5 kW → Schnitt zwischen +2 und +5 °C
  const schwach = bivalenz(geraet([P(-7, 50, 4), P(2, 50, 5)]), 50, linie, -8);
  wahr(schwach.art === 'punkt' && schwach.theta > 2 && schwach.theta < 5, `Schnitt oberhalb von +2 °C: ${schwach.theta}`);
  wahr(!bivalenz(geraet([P(-7, 35, 9)]), 50, linie, -8).ok, 'ohne ausreichende Punkte');
});

// Heizkurve: t_V(θ) = θ_soll + (Y − θ_soll) · (θ_soll − θ) / (θ_soll − θ_e), θ_soll = 20 °C, Y = 56 °C, θ_e = −8 °C (Spanne 28 K, Y − θ_soll = 36 K)
//   +7 °C:  20 + 36 · 13 / 28 = 36,714 °C     +2 °C: 20 + 36 · 18 / 28 = 43,143 °C     +12 °C: 20 + 36 · 8 / 28 = 30,286 °C
//   −8 °C:  20 + 36 · 28 / 28 = 56 °C (= Y)    +20 °C: 20 °C, nach unten auf 25 °C begrenzt
test('Heizkurve: θ_soll 20 °C, Y 56 °C, θ_e −8 °C ergibt bei +7 °C 36,71 °C', () => {
  gleich(heizkurve(20, -8, 56, 7), 20 + (36 * 13) / 28, 1e-9, '+7 °C');
  gleich(heizkurve(20, -8, 56, 7), 36.7143, 1e-4, '+7 °C Zahl');
  gleich(heizkurve(20, -8, 56, 2), 43.1429, 1e-4, '+2 °C');
  gleich(heizkurve(20, -8, 56, 12), 30.2857, 1e-4, '+12 °C');
  gleich(heizkurve(20, -8, 56, -8), 56, 1e-9, 'bei θ_e gleich Y');
  gleich(heizkurve(20, -8, 56, 20), 25, 1e-9, 'Untergrenze 25 °C');
  gleich(heizkurve(20, -8, 56, 15), 26.4286, 1e-4, '+15 °C: 20 + 36 · 5 / 28');
});

// Taktprüfung (H = 300 W/K, θ_soll 20 °C, untere Grenze): Heizlast bei +7 °C = 300 · 13 = 3,9 kW, bei +2 °C = 300 · 18 = 5,4 kW, bei +12 °C = 300 · 8 = 2,4 kW
//   minimale Leistung 3,0 kW ≤ 3,9 kW → grün; 4,5 kW > 3,9 kW, aber ≤ 5,4 kW → gelb; 5,6 kW > 5,4 kW → rot
test('Taktprüfung: 3,0 kW gegen 3,9 kW bei +7 °C ist grün, 4,5 kW gelb, 5,6 kW rot', () => {
  const linie = heizlastLinie({ min: 8400, max: 8400 }, 20, -8);
  const t = takt(geraet([P(7, 35, 11, 3.0)]), linie, 35);
  gleich(t.l7, 3.9, 1e-9, 'Heizlast +7 °C');
  gleich(t.l2, 5.4, 1e-9, 'Heizlast +2 °C');
  gleich(t.l12, 2.4, 1e-9, 'Heizlast +12 °C');
  wahr(t.ampel === 'gruen', `3,0 kW: ${t.ampel}`);
  wahr(takt(geraet([P(7, 35, 11, 3.9)]), linie, 35).ampel === 'gruen', '3,9 kW genau auf der Grenze: grün');
  wahr(takt(geraet([P(7, 35, 11, 4.5)]), linie, 35).ampel === 'gelb', '4,5 kW: gelb');
  wahr(takt(geraet([P(7, 35, 11, 5.6)]), linie, 35).ampel === 'rot', '5,6 kW: rot');
  wahr(!takt(geraet([P(2, 35, 9, 3.0)]), linie, 35).ok, 'ohne Minimalpunkt bei A7 oder höher nicht prüfbar');
  wahr(takt(geraet([P(7, 35, 11, 3.0)]), linie, null).m7.quelle === 'kleinster', 'ohne Vorlauf Y: kleinster Wert bei A7 oder höher');
});

// Taktprüfung mit Heizkurve (θ_soll 20 °C, θ_e −8 °C): Y = 56 °C, Datenblatt A7/W35 min 3,0 kW und A7/W55 min 3,4 kW.
//   Vorlauf bei +7 °C: 36,714 °C, innerhalb von 35 bis 55 °C: min = 3,0 + (3,4 − 3,0) / (55 − 35) · (36,714 − 35) = 3,0 + 0,02 · 1,714 = 3,0343 kW
//   Bei +2 °C (43,143 °C) gibt es nur Punkte bei A7, 5 K entfernt, eine einzelne Außentemperatur lässt sich nicht fortsetzen:
//   nächstliegender Punkt nach |ΔA| + |ΔV|: A7/W35 → 5 + 8,143 = 13,143, A7/W55 → 5 + 11,857 = 16,857, also A7/W35 mit 3,0 kW
test('Taktprüfung mit Heizkurve: minimale Leistung bei 36,71 °C interpoliert, sonst nächstliegender Punkt', () => {
  const linie = heizlastLinie({ min: 8400, max: 8400 }, 20, -8);
  const t = takt(geraet([P(7, 35, 11, 3.0), P(7, 55, 9.5, 3.4)]), linie, 56, -8);
  wahr(t.m7.quelle === 'interpoliert', t.m7.quelle);
  gleich(t.m7.vorlauf, 36.7143, 1e-4, 'Vorlauf +7 °C');
  gleich(t.m7.kW, 3 + 0.02 * (20 + (36 * 13) / 28 - 35), 1e-9, 'interpoliert');
  gleich(t.m7.kW, 3.0343, 1e-4, 'Zahl');
  wahr(t.m2.quelle === 'naechster' && t.m2.punkt.vorlauf === 35 && t.m2.kW === 3.0, `+2 °C: ${t.m2.quelle}`);
  gleich(t.m2.vorlauf, 43.1429, 1e-4, 'Vorlauf +2 °C');
  wahr(t.ampel === 'gruen', 'Takt grün');
  // Der Text der Karte nennt Heizkurve und nächstliegenden Punkt
  const k = { obereKW: 8.4, thetaE: -8, vorlauf: 56, vorlaufGrund: null, linie, linieGrund: null, schwellen: STANDARD_SCHWELLEN };
  const text = pruefeGeraet(geraet([P(-7, 35, 9), P(-7, 55, 7), P(7, 35, 11, 3.0), P(7, 55, 9.5, 3.4)]), k).kriterien.find((c) => c.id === 'takt').text;
  wahr(text.includes('interpoliert') && text.includes('nächstliegender Datenblattpunkt A7/W35'), text);
});

// Vorauswahl: Verhältnis = BAFA-Nennleistung 55 °C / obere Grenze. 9,0 / 8,4 = 1,0714 → grün.
test('Vorauswahl (Stufe A): 9,0 kW BAFA-Nennleistung gegen 8,4 kW ergibt 1,07 und grün; Grenzen', () => {
  const v = vorauswahl(9.0, 8.4);
  gleich(v.verhaeltnis, 1.0714, 1e-4, 'Verhältnis');
  wahr(v.ampel === 'gruen', 'grün');
  // 8,4 · 0,9 = 7,56; 8,4 · 1,3 = 10,92; 8,4 · 0,75 = 6,3; 8,4 · 1,6 = 13,44
  const a = (kw) => vorauswahl(kw, 8.4).ampel;
  wahr(a(7.56) === 'gruen' && a(10.92) === 'gruen', '0,9 und 1,3 sind grün');
  wahr(a(6.72) === 'gelb' && a(12.6) === 'gelb', '0,8 und 1,5 sind gelb');
  wahr(a(6.3) === 'gelb' && a(13.44) === 'gelb', '0,75 und 1,6 sind gelb');
  wahr(a(5.88) === 'rot' && a(14.28) === 'rot', '0,7 und 1,7 sind rot');
});

// ETAs: 190 % bei 35 °C, 150 % bei 55 °C. Bei Y = 45 °C: 190 − 2 · 10 = 170 %. Bei 33 °C (2 K darunter): 194 %.
test('Effizienz: ETAs linear zwischen 35 °C und 55 °C', () => {
  const g = geraet([], { bafa: { ...neueWaermepumpe().bafa, eta35: 190, eta55: 150 } });
  gleich(effizienz(g, 45).eta, 170, 1e-9, '45 °C');
  gleich(effizienz(g, 33).eta, 194, 1e-9, '33 °C');
  wahr(!effizienz(g, 60).ok, '60 °C liegt mehr als 3 K außerhalb');
  wahr(!effizienz(geraet([]), 45).ok, 'ohne ETAs');
});

// Vollständige Prüfung: Gerät mit A−7/W35 9,0, A−7/W55 7,0, A2/W50 9,5, A7/W35 max 11,0 min 3,0; Auslegung 8,4 kW bei −8 °C, Y = 50 °C.
//   P(−8) = 7,2778 kW → Deckung 7,2778 / 8,4 = 86,6 %; Standardgrenzen: grün ab 80 %, gelb ab 65 %.
//   Bivalenz −5,85 °C; Standardgrenzen: grün bis −4 °C, gelb bis −1 °C, darüber rot. Takt 3,0 ≤ 3,9 kW (grün).
//   Mit eigenen Grenzen (Deckung grün ab 90 %, gelb ab 80 %; Bivalenz grün bis −6 °C, gelb bis −5 °C) werden beide gelb.
test('Geräteprüfung (Stufe B): Deckung 86,6 % und Bivalenz −5,85 °C grün mit Standardgrenzen, gelb mit eigenen', () => {
  const k = { obereKW: 8.4, thetaE: -8, vorlauf: 50, vorlaufGrund: null, linie: heizlastLinie({ min: 8400, max: 8400 }, 20, -8), linieGrund: null, schwellen: STANDARD_SCHWELLEN };
  const g = geraet([P(-7, 35, 9), P(-7, 55, 7), P(2, 50, 9.5), P(7, 35, 11, 3.0)]);
  wahr(fehlendeWerte(g).length === 0, `Pflichtwerte vorhanden: ${fehlendeWerte(g)}`);
  const r = pruefeGeraet(g, k);
  const c = (id) => r.kriterien.find((x) => x.id === id);
  wahr(r.stufe === 'B', 'Stufe B');
  wahr(c('deckung').ampel === 'gruen' && c('deckung').wert === '86,6 %', `${c('deckung').ampel} ${c('deckung').wert}`);
  wahr(c('bivalenz').ampel === 'gruen' && c('bivalenz').wert === '−5,9 °C', `${c('bivalenz').ampel} ${c('bivalenz').wert}`);
  wahr(c('bivalenz').text.includes('1,12 kW'), c('bivalenz').text);
  wahr(c('takt').ampel === 'gruen', 'Takt grün');
  wahr(c('schall').ampel === 'grau' && c('schall').text.startsWith('nicht prüfbar'), 'ohne Schall: nicht prüfbar');
  wahr(!r.kriterien.some((x) => x.id === 'gesamt'), 'keine Gesamtnote');
  const eigen = pruefeGeraet(g, { ...k, schwellen: { bivalenzGruen: -6, bivalenzGelb: -5, deckungGruen: 90, deckungGelb: 80 } });
  wahr(eigen.kriterien.find((x) => x.id === 'deckung').ampel === 'gelb', 'Deckung 86,6 % mit eigenen Grenzen gelb');
  wahr(eigen.kriterien.find((x) => x.id === 'bivalenz').ampel === 'gelb', 'Bivalenz −5,85 °C mit eigenen Grenzen gelb');
  const streng = pruefeGeraet(g, { ...k, schwellen: { bivalenzGruen: -8, bivalenzGelb: -7, deckungGruen: 95, deckungGelb: 90 } });
  wahr(streng.kriterien.find((x) => x.id === 'deckung').ampel === 'rot' && streng.kriterien.find((x) => x.id === 'bivalenz').ampel === 'rot', 'strenge Grenzen: rot');
  // Ohne Heizstabbedarf bis θ_e (stärkeres Gerät: 10,0 / 9,0 kW bei A−7, W35 / W55 → 9,25 kW bei W50, A2/W50 11,0 kW → P(−8) = 9,25 − 1,75/9 = 9,056 kW ≥ 8,4 kW):
  // grün nach den Grenzen, der Text nennt die Überdimensionierung
  const stark = pruefeGeraet(geraet([P(-7, 35, 10), P(-7, 55, 9), P(2, 50, 11), P(7, 35, 12, 3.0)]), k).kriterien.find((x) => x.id === 'bivalenz');
  wahr(stark.wert === 'unter −8 °C' && stark.ampel === 'gruen' && stark.text.includes('überdimensioniert'), `${stark.wert} ${stark.text}`);
});

test('Geräteprüfung: fehlende Werte werden benannt, nichts wird geraten', () => {
  const k = { obereKW: 8.4, thetaE: -8, vorlauf: 50, vorlaufGrund: null, linie: heizlastLinie({ min: 8400, max: 8400 }, 20, -8), linieGrund: null };
  const g = geraet([P(-7, 35, 9)]);
  wahr(fehlendeWerte(g).join('|') === 'maximale Heizleistung bei A−7 / W55|minimale Heizleistung bei A7 oder höher', fehlendeWerte(g).join('|'));
  const r = pruefeGeraet(g, k);
  wahr(r.kriterien.find((x) => x.id === 'deckung').text === 'nicht prüfbar: maximale Heizleistung bei A−7 / W55', r.kriterien.find((x) => x.id === 'deckung').text);
  wahr(r.kriterien.find((x) => x.id === 'takt').text === 'nicht prüfbar: minimale Heizleistung bei A7 oder höher', 'Takt');
  const ohneY = pruefeGeraet(geraet([P(-7, 35, 9), P(-7, 55, 7), P(7, 35, 11, 3)]), { ...k, vorlauf: null, vorlaufGrund: 'Vorlauf nicht bestimmbar: Heizkörperleistung fehlt in Bad' });
  wahr(ohneY.kriterien.find((x) => x.id === 'deckung').text.includes('Heizkörperleistung fehlt in Bad'), ohneY.kriterien.find((x) => x.id === 'deckung').text);
  wahr(ohneY.kriterien.find((x) => x.id === 'takt').ampel !== 'grau', 'der Takt braucht keinen Vorlauf');
  // Bei Y = 50 °C bleibt nur A−7 brauchbar (A7 hat nur W35): eine einzelne Außentemperatur lässt sich nicht fortsetzen
  const weit = pruefeGeraet(geraet([P(-7, 35, 9), P(-7, 55, 7), P(7, 35, 11, 3)]), k);
  wahr(weit.kriterien.find((x) => x.id === 'deckung').text.includes('Datenblattpunkte reichen nicht'), weit.kriterien.find((x) => x.id === 'deckung').text);
});

test('Liste: geprüfte Geräte zuerst, dann vorausgewählte, dann ohne Werte; Sortierung nach Kriterium', () => {
  const k = { obereKW: 8.4, thetaE: -8, vorlauf: 50, vorlaufGrund: null, linie: heizlastLinie({ min: 8400, max: 8400 }, 20, -8), linieGrund: null };
  const bafa = (n) => ({ ...neueWaermepumpe().bafa, nennleistung55: n });
  const stark = geraet([P(-7, 50, 9), P(2, 50, 10.5), P(-7, 35, 9.5), P(-7, 55, 8), P(7, 35, 11, 3.0)], { modell: 'Stark' });
  const schwach = geraet([P(-7, 35, 7), P(-7, 55, 5.5), P(2, 50, 7.2), P(7, 35, 9, 3.5)], { modell: 'Schwach' });
  const nurBafa = geraet([], { modell: 'NurBafa', bafa: bafa(9) });
  const leer = geraet([], { modell: 'Leer' });
  const liste = pruefeListe([leer, nurBafa, schwach, stark], k);
  const reihenfolge = liste.map((r) => `${r.geraet.modell}:${r.stufe}`).join(',');
  wahr(reihenfolge === 'Schwach:B,Stark:B,NurBafa:A,Leer:keine', reihenfolge);
  const nachDeckung = pruefeListe([leer, nurBafa, schwach, stark], k, 'deckung');
  wahr(nachDeckung[0].geraet.modell === 'Stark' && nachDeckung[1].geraet.modell === 'Schwach', `nach Deckung: ${nachDeckung.map((r) => r.geraet.modell)}`);
  wahr(nachDeckung[nachDeckung.length - 1].geraet.modell === 'Leer' || nachDeckung[nachDeckung.length - 2].geraet.modell === 'Leer', 'nicht prüfbare zuletzt');
  const vor = liste.find((r) => r.geraet.modell === 'NurBafa').kriterien[0];
  wahr(vor.id === 'vorauswahl' && vor.ampel === 'gruen' && vor.wert === 'Verhältnis 1,07', `${vor.id} ${vor.ampel} ${vor.wert}`);
  wahr(liste.find((r) => r.geraet.modell === 'NurBafa').hinweis.includes('−10 °C'), 'Hinweis zur BAFA-Nennleistung');
});

test('Schall und Effizienz: nur Vergleich untereinander, mit einem Gerät neutral', () => {
  const k = { obereKW: 8.4, thetaE: -8, vorlauf: 45, vorlaufGrund: null, linie: null, linieGrund: 'x' };
  const mit = (modell, schall, eta35, eta55) => geraet([], { modell, schall, bafa: { ...neueWaermepumpe().bafa, nennleistung55: 9, eta35, eta55 } });
  const alle = pruefeListe([mit('A', 50, 190, 150), mit('B', 58, 180, 140), mit('C', 54, 185, 145)], k, 'name');
  const s = (m) => alle.find((r) => r.geraet.modell === m).kriterien.find((c) => c.id === 'schall').ampel;
  wahr(s('A') === 'gruen' && s('B') === 'rot' && s('C') === 'gelb', `Schall ${s('A')} ${s('B')} ${s('C')}`);
  const sk = (m) => alle.find((r) => r.geraet.modell === m).kriterien.find((c) => c.id === 'schall');
  wahr(sk('A').rang === 'Rang 1 von 3' && sk('C').rang === 'Rang 2 von 3' && sk('B').rang === 'Rang 3 von 3', 'Rangfolge Schall');
  wahr(sk('A').wert === '50 dB(A)' && sk('B').wert === '58 dB(A)' && sk('A').rangfolge === true, 'der echte Wert steht neben der Rangfolge');
  wahr(alle.find((r) => r.geraet.modell === 'A').kriterien.find((c) => c.id === 'effizienz').wert === '170 %', 'echter ETAs-Wert (190 − 2 · 10 bei 45 °C)');
  const e = (m) => alle.find((r) => r.geraet.modell === m).kriterien.find((c) => c.id === 'effizienz').ampel;
  wahr(e('A') === 'gruen' && e('B') === 'rot' && e('C') === 'gelb', 'Effizienz');
  const einzel = pruefeListe([mit('A', 50, 190, 150)], k);
  wahr(einzel[0].kriterien.find((c) => c.id === 'schall').ampel === 'grau', 'ein Gerät: neutral');
});

const mini = () => ({
  einstellungen: {
    projektname: 'Mini', thetaAussen: -8, dUWB: { min: 0.1, max: 0.1 }, luftwechselStandard: { min: 0.5, max: 0.5 }, fg: 1,
    aufheizzuschlag: { aktiv: false, wProM2: 0 }, spreizung: 5, heizkoerperExponent: 1.3, zielVorlauf: 45,
  },
  zonen: [], bauteile: [{ id: 'bt-dach', name: 'Flachdach', art: 'dach', u: { min: 1, max: 1 }, aufbau: '', quelle: 'schaetzung' }], oeffnungstypen: [],
  raeume: [{ id: 'r', name: 'Raum', geschoss: 'EG', status: 'beheizt', theta: 20, flaeche: 10, hoehe: 2.5, volumenManuell: null, luftwechsel: null, waermeLieferanten: [] }],
  flaechen: [{ id: 'f', raumId: 'r', bauteilId: 'bt-dach', angrenzend: { art: 'aussen' }, modus: 'flaeche', flaeche: 10, oeffnungen: [] }],
  heizkoerper: [], verbrauch: [], fotoInfos: [], markierungen: [],
});

test('Kontext aus dem Ergebnis: obere Grenze, Außentemperatur, nötiger Vorlauf und Linie', () => {
  const k0 = kontextAusErgebnis(baueErgebnis(mini()));
  gleich(k0.obereKW, 0.427, 1e-9, 'obere Grenze 427 W');
  wahr(k0.thetaE === -8 && k0.vorlauf === null && k0.vorlaufGrund.includes('Kein Heizkörper'), 'ohne Heizkörper kein Vorlauf');
  gleich(k0.linie.hMax, 427 / 28, 1e-9, 'H = 427 W / 28 K');
  const p = mini();
  p.heizkoerper = [{ id: 'hk', raumId: 'r', bauart: 'platten', typ: '22', status: 'bleibt', material: 'stahl', ventil: 'neu', name: 'P', normleistung: 1000, normVorlauf: 75, normRuecklauf: 65, normRaum: 20, exponent: null, kennlinie: [], kennlinieRaumtemperatur: 20, notiz: '' }];
  const e = baueErgebnis(p);
  wahr(kontextAusErgebnis(e).vorlauf === e.waermepumpe.vorlauf.grad && kontextAusErgebnis(e).vorlauf > 25, 'Y aus dem bestimmenden Raum');
  wahr(kontextAusErgebnis({ hatErgebnis: false }) === null, 'ohne Ergebnis kein Kontext');
});

test('Katalog: Prüfung der Eingaben im Formular', () => {
  wahr(validiereWaermepumpe({ ...neueWaermepumpe(), modell: 'X' }).length === 0, 'BAFA-Werte allein genügen, keine Meldung');
  wahr(validiereWaermepumpe(neueWaermepumpe()).some((m) => m.feld === 'modell' && m.stufe === 'fehler'), 'Modell fehlt');
  const m = validiereWaermepumpe({ ...neueWaermepumpe(), modell: 'X', punkte: [P(-7, 35, 9)] });
  wahr(m.some((x) => x.stufe === 'warnung' && x.text.includes('maximale Heizleistung bei A−7 / W55')), 'fehlende Pflichtpunkte als Warnung');
  wahr(validiereWaermepumpe({ ...neueWaermepumpe(), modell: 'X', punkte: [P(-7, 35, 5, 6)] }).some((x) => x.stufe === 'fehler' && x.text.includes('minimale')), 'min größer als max');
  wahr(validiereWaermepumpe({ ...neueWaermepumpe(), modell: 'X', punkte: [{ aussen: -7, vorlauf: 35, max: null, min: null, cop: null }] }).some((x) => x.stufe === 'fehler'), 'Punkt ohne Leistung');
  wahr(validiereWaermepumpe({ ...neueWaermepumpe(), modell: 'X', punkte: [{ aussen: NaN, vorlauf: 35, max: 5, min: null, cop: null }] }).some((x) => x.stufe === 'fehler'), 'unlesbare Eingabe');
  wahr(validiereWaermepumpe({ ...neueWaermepumpe(), modell: 'X', datenblatt: 'datenblatt.pdf' }).some((x) => x.feld === 'datenblatt'), 'Link ohne http');
});

async function ladeText(name) {
  const adresse = new URL(`../examples/${name}`, import.meta.url);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(adresse, 'utf8');
  }
  return (await fetch(adresse)).text();
}

test('Katalogdatei: Beispielkatalog lesen, exportieren und wieder lesen; Hausdaten bleiben draußen', async () => {
  const gelesen = pruefeKatalogImport(await ladeText('beispiel-waermepumpen.json'));
  wahr(gelesen.ok && gelesen.geraete.length === 2, JSON.stringify(gelesen.fehler));
  const alpha = gelesen.geraete.find((g) => g.modell === 'Alpha 9');
  wahr(alpha.punkte.length === 6 && fehlendeWerte(alpha).length === 0, 'Alpha 9 ist vollständig');
  const datei = baueKatalogExport(gelesen.geraete, new Date(2026, 9, 24));
  wahr(datei.format === 'heizlast-waermepumpenkatalog' && datei.schemaVersion === 4, 'Kennung und Version');
  wahr(Object.keys(datei.daten).join() === 'waermepumpen', 'nur der Katalog in der Datei');
  const zurueck = pruefeKatalogImport(JSON.stringify(datei));
  wahr(JSON.stringify(zurueck.geraete) === JSON.stringify(gelesen.geraete), 'unverändert zurück');
  wahr(!pruefeKatalogImport('kein json').ok, 'kein JSON');
  wahr(!pruefeKatalogImport(JSON.stringify({ ...datei, schemaVersion: 5 })).ok, 'neuere Version abgelehnt');
  wahr(!pruefeKatalogImport(JSON.stringify({ ...datei, daten: { waermepumpen: [{ modell: 'ohne ID' }] } })).ok, 'ID fehlt');
  wahr(!pruefeKatalogImport(JSON.stringify({ ...datei, daten: { waermepumpen: [{ id: 'a' }, { id: 'a' }] } })).ok, 'doppelte ID');
});

test('Sicherung enthält den Katalog (Version 4); Katalogdatei und Sicherung lassen sich nicht verwechseln; ältere Dateien behalten den Katalog', async () => {
  const katalog = pruefeKatalogImport(await ladeText('beispiel-waermepumpen.json')).geraete;
  const speicher = pruefeImport(await ladeText('beispiel-mini-haus.json')).daten;
  wahr(speicher.heatpumps.length === 0, 'Beispielhaus hat keinen Katalog');
  const alt = pruefeImport(await ladeText('beispiel-mini-haus.json'));
  wahr(alt.ok && alt.hatKatalog === false, 'ältere Datei: hatKatalog false, der vorhandene Katalog bleibt beim Import');
  speicher.heatpumps = katalog;
  const datei = baueExport(speicher, new Date(2026, 9, 24));
  wahr(datei.schemaVersion === 4 && datei.daten.waermepumpen.length === 2, 'Export mit Katalog');
  const neu = pruefeImport(JSON.stringify(datei));
  wahr(neu.ok && neu.hatKatalog === true && neu.daten.heatpumps.length === 2 && neu.zusammenfassung.waermepumpen === 2, 'Import mit Katalog');
  wahr(zusammenfassung(neu.daten).waermepumpen === 2, 'Zusammenfassung');
  const verwechselt = pruefeImport(JSON.stringify(baueKatalogExport(katalog)));
  wahr(!verwechselt.ok && verwechselt.fehler[0].includes('Katalogdatei'), 'Katalogdatei als Sicherung abgelehnt');
  const umgekehrt = pruefeKatalogImport(JSON.stringify(datei));
  wahr(!umgekehrt.ok && umgekehrt.fehler[0].includes('Sicherung'), 'Sicherung als Katalogdatei abgelehnt');
  wahr(normalisiereWaermepumpe({ modell: 'x' }).punkte.length === 0, 'Normalisierung ergänzt Felder');
});

test('Ampelgrenzen: Standardwerte, eigene Werte und Prüfung in den Rechenannahmen', () => {
  wahr(JSON.stringify(schwellen({})) === JSON.stringify({ bivalenzGruen: -4, bivalenzGelb: -1, deckungGruen: 80, deckungGelb: 65 }), 'Standard: −4 / −1 °C, 80 / 65 %');
  const eigen = schwellen({ geraetepruefung: { bivalenzGruen: -5, deckungGruen: 90 } });
  wahr(eigen.bivalenzGruen === -5 && eigen.deckungGruen === 90 && eigen.bivalenzGelb === -1 && eigen.deckungGelb === 65, 'fehlende Werte nehmen den Standard');
  wahr(BIVALENZ_HINWEIS.startsWith('Ein Bivalenzpunkt um −5 °C ist bei monoenergetischen Luft-Wasser-Wärmepumpen üblich.'), 'Hinweistext');
  const basis = { thetaAussen: -8, luftwechselStandard: { min: 0.5, max: 1 }, dUWB: { min: 0.05, max: 0.15 }, fg: 1, aufheizzuschlag: { aktiv: false, wProM2: 0 }, spreizung: 5, heizkoerperExponent: 1.3 };
  wahr(!hatFehler(validiereEinstellungen({ ...basis, geraetepruefung: STANDARD_SCHWELLEN })), 'Standardwerte sind gültig');
  wahr(hatFehler(validiereEinstellungen({ ...basis, geraetepruefung: { ...STANDARD_SCHWELLEN, bivalenzGruen: 0 } })), 'grüne Bivalenzgrenze über der gelben');
  wahr(hatFehler(validiereEinstellungen({ ...basis, geraetepruefung: { ...STANDARD_SCHWELLEN, deckungGruen: 50 } })), 'grüne Deckungsgrenze unter der gelben');
  wahr(hatFehler(validiereEinstellungen({ ...basis, geraetepruefung: { ...STANDARD_SCHWELLEN, deckungGelb: NaN } })), 'unlesbare Eingabe');
});

test('Ergebnis: Heizkurve als Tabelle zur Heizlastlinie', () => {
  const p = mini();
  p.heizkoerper = [{ id: 'hk', raumId: 'r', bauart: 'platten', typ: '22', status: 'bleibt', material: 'stahl', ventil: 'neu', name: 'P', normleistung: 1000, normVorlauf: 75, normRuecklauf: 65, normRaum: 20, exponent: null, kennlinie: [], kennlinieRaumtemperatur: 20, notiz: '' }];
  const e = baueErgebnis(p);
  const y = e.waermepumpe.vorlauf.grad;
  const bei = (t) => e.linie.punkte.find((x) => x.theta === t).vorlauf;
  gleich(bei(-8), y, 1e-9, 'bei θ_e gleich Y');
  gleich(bei(7), Math.max(25, 20 + ((y - 20) * 13) / 28), 1e-9, '+7 °C: 20 + (Y − 20) · 13 / 28');
  wahr(e.linie.punkte.every((x) => x.vorlauf >= 25), 'nie unter 25 °C');
  wahr(JSON.stringify(baueBericht(p, new Date(2026, 9, 24))).includes('Vorlauf (Heizkurve)'), 'Heizkurve im Bericht');
  wahr(baueErgebnis(mini()).linie.punkte[0].vorlauf === undefined, 'ohne bestimmbaren Vorlauf keine Heizkurve');
});

test('Bericht: Geräteprüfung auf einer eigenen Seite, nur mit Geräten im Katalog', () => {
  const g = geraet([P(-7, 35, 9), P(-7, 55, 7), P(2, 50, 9.5), P(7, 35, 11, 3.0)], { schall: 52 });
  const p = mini();
  p.heizkoerper = [{ id: 'hk', raumId: 'r', bauart: 'platten', typ: '22', status: 'bleibt', material: 'stahl', ventil: 'neu', name: 'P', normleistung: 1000, normVorlauf: 75, normRuecklauf: 65, normRaum: 20, exponent: null, kennlinie: [], kennlinieRaumtemperatur: 20, notiz: '' }];
  const b = baueBericht(p, new Date(2026, 9, 24), { waermepumpen: [g, geraet([], { modell: 'NurBafa', bafa: { ...neueWaermepumpe().bafa, nennleistung55: 0.5 } })] });
  const a = b.abschnitte.find((x) => x.titel.includes('Geräteprüfung'));
  wahr(a && a.neueSeite === true && b.abschnitte.indexOf(a) === 1, 'eigene Seite direkt nach dem Ergebnis');
  const json = JSON.stringify(a);
  wahr(json.includes('Test M') && json.includes('Prüfung (Stufe B)') && json.includes('Vorauswahl (Stufe A)'), 'beide Stufen');
  wahr(json.includes('Taktprüfung') && json.includes('Deckung bei −8 °C') && json.includes('Bivalenzpunkt'), 'Kriterien');
  wahr(json.includes('Grenzen der Ampeln') && json.includes('Rangfolge'), 'Grenzen und Rangfolge');
  wahr(!baueBericht(p, new Date(2026, 9, 24)).abschnitte.some((x) => x.titel.includes('Geräteprüfung')), 'ohne Katalog keine Seite');
  wahr(!baueBericht(p, new Date(2026, 9, 24), { waermepumpen: [] }).abschnitte.some((x) => x.titel.includes('Geräteprüfung')), 'leerer Katalog: keine Seite');
});
