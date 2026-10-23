// Tests für Heizkörperleistung, nötige Vorlauftemperatur und die Bewertung der Räume.
// Die Handrechnungen stehen als Kommentar bei den Tests.

import { test, gleich, wahr } from './runner.js';
import { heizkoerperLeistung, interpoliereKennlinie } from '../js/engine/radiator.js';
import { installierteLeistung, noetigeVorlauftemperatur, bewerteRaeume } from '../js/engine/vorlauf.js';
import { berechneGebaeude } from '../js/engine/heatload.js';

// Standard-Heizkörper: 1000 W bei 75/65/20, Exponent 1,3, Spreizung im Betrieb 5 K.
// Vergleichswerte (von Hand, ΔT_log,n = 10 / ln(55/45) = 49,833 K):
//   45/40/20: ΔT_log = 5 / ln(25/20) = 22,407 K → (22,407 / 49,833)^1,3 = 0,3538 → 353,8 W
//   50/45/20: ΔT_log = 5 / ln(30/25) = 27,424 K → 0,5503^1,3 = 0,4600           → 460,1 W
//   55/50/20: ΔT_log = 5 / ln(35/30) = 32,436 K → 0,6509^1,3 = 0,5722           → 572,2 W
//   60/55/20: ΔT_log = 5 / ln(40/35) = 37,444 K → 0,7514^1,3 = 0,6897           → 689,7 W
//   75/70/20: ΔT_log = 5 / ln(55/50) = 52,459 K → 1,0527^1,3 = 1,0690           → 1069,0 W
const standard = (id = 'h1', extra = {}) => ({
  id, status: 'bleibt', bauart: 'platten', phiN: 1000, n: 1.3, norm: { tV: 75, tR: 65, ti: 20 }, ventil: 'neu', ...extra,
});
const betrieb = { spreizung: 5, ti: 20 };

// Wärmepumpen-Heizkörper aus dem Datenblatt: Wertepaare (Vorlauf °C, Leistung W) bei 20 °C Raumtemperatur.
const kennlinie = [{ vorlauf: 35, leistung: 600 }, { vorlauf: 45, leistung: 1000 }, { vorlauf: 55, leistung: 1400 }];
const waermepumpe = (id = 'wp1', extra = {}) => ({
  id, status: 'neu', bauart: 'wp', kennlinie, kennlinieRaumtemperatur: 20, ventil: 'neu', ...extra,
});

// --- Kennlinie (Wärmepumpen-Heizkörper) ------------------------------------------------------
//
// Wertepaare (35 °C | 600 W), (45 °C | 1000 W), (55 °C | 1400 W). Beide Abschnitte steigen mit 40 W/K.
//   40 °C: 600 + 40 · (40 − 35) =  800 W
//   50 °C: 1000 + 40 · (50 − 45) = 1200 W
test('Kennlinie: lineare Interpolation zwischen den Wertepaaren', () => {
  gleich(interpoliereKennlinie(kennlinie, 35).leistung, 600, 1e-9, '35 °C');
  gleich(interpoliereKennlinie(kennlinie, 40).leistung, 800, 1e-9, '40 °C');
  gleich(interpoliereKennlinie(kennlinie, 45).leistung, 1000, 1e-9, '45 °C');
  gleich(interpoliereKennlinie(kennlinie, 50).leistung, 1200, 1e-9, '50 °C');
  gleich(interpoliereKennlinie(kennlinie, 55).leistung, 1400, 1e-9, '55 °C');
});

test('Kennlinie: außerhalb des Bereichs keine Extrapolation, stattdessen Hinweis mit dem Bereich', () => {
  for (const tV of [30, 34.9, 55.1, 60]) {
    const ergebnis = interpoliereKennlinie(kennlinie, tV);
    wahr(ergebnis.art === 'ausserhalb' && ergebnis.von === 35 && ergebnis.bis === 55, `${tV} °C außerhalb`);
    wahr(ergebnis.leistung === undefined, 'es darf kein Leistungswert erfunden werden');
  }
});

test('Kennlinie: weniger als zwei Paare bedeutet "Leistung fehlt", Reihenfolge der Eingabe ist egal', () => {
  wahr(interpoliereKennlinie([], 40).art === 'fehlt', 'keine Paare');
  wahr(interpoliereKennlinie([{ vorlauf: 40, leistung: 800 }], 40).art === 'fehlt', 'ein Paar');
  const durcheinander = [kennlinie[2], kennlinie[0], kennlinie[1]];
  gleich(interpoliereKennlinie(durcheinander, 40).leistung, 800, 1e-9, 'unsortiert');
});

test('Wärmepumpen-Heizkörper nutzt die Kennlinie, nicht den Exponenten', () => {
  const l = heizkoerperLeistung(waermepumpe(), { tV: 40, tR: 35, ti: 20 });
  gleich(l.leistung, 800, 1e-9, 'Leistung bei 40 °C');
});

test('Heizkörper ohne Normleistung oder mit unmöglichen Bedingungen: Leistung fehlt', () => {
  wahr(heizkoerperLeistung(standard('a', { phiN: null }), { tV: 45, tR: 40, ti: 20 }).art === 'fehlt', 'ohne Normleistung');
  wahr(heizkoerperLeistung(standard('b', { norm: { tV: 65, tR: 75, ti: 20 } }), { tV: 45, tR: 40, ti: 20 }).art === 'fehlt', 'Rücklauf über Vorlauf');
  wahr(heizkoerperLeistung(standard('c', { norm: null }), { tV: 45, tR: 40, ti: 20 }).art === 'fehlt', 'ohne Bedingungen');
});

// --- Nötige Vorlauftemperatur ----------------------------------------------------------------
//
// Entspricht die Heizlast der Heizkörperleistung bei einer Vorlauftemperatur, ist das die Lösung.
//   353,8 W → 45 °C, 460,1 W → 50 °C, 572,2 W → 55 °C, 689,7 W → 60 °C (Werte oben)
test('Vorlauftemperatur: Heizlast gleich Heizkörperleistung ergibt die zugehörige Temperatur', () => {
  const faelle = [[353.78, 45], [460.05, 50], [572.22, 55], [689.65, 60]];
  for (const [heizlast, erwartet] of faelle) {
    const ergebnis = noetigeVorlauftemperatur({ heizkoerper: [standard()], heizlast, ...betrieb });
    wahr(ergebnis.status === 'ok', `Status bei ${heizlast} W`);
    gleich(ergebnis.vorlauf, erwartet, 0.01, `Vorlauf bei ${heizlast} W`);
  }
});

test('Vorlauftemperatur: zwei Heizkörper im Raum addieren ihre Leistung', () => {
  // 2 · 353,78 W = 707,56 W werden bei 45 °C erreicht.
  const ergebnis = noetigeVorlauftemperatur({ heizkoerper: [standard('a'), standard('b')], heizlast: 707.56, ...betrieb });
  gleich(ergebnis.vorlauf, 45, 0.01, 'Vorlauf');
});

test('Vorlauftemperatur: Heizkörper mit Status "entfällt" zählt nicht', () => {
  const heizkoerper = [standard('a'), standard('b', { status: 'entfaellt' })];
  const ergebnis = noetigeVorlauftemperatur({ heizkoerper, heizlast: 353.78, ...betrieb });
  gleich(ergebnis.vorlauf, 45, 0.01, 'nur ein Heizkörper trägt bei');
});

test('Vorlauftemperatur: "geplant" und "neu" zählen mit', () => {
  const heizkoerper = [standard('a', { status: 'neu' }), standard('b', { status: 'geplant' })];
  gleich(noetigeVorlauftemperatur({ heizkoerper, heizlast: 707.56, ...betrieb }).vorlauf, 45, 0.01, 'Vorlauf');
});

// Bei 75 °C leistet ein 1000-W-Heizkörper 1069,0 W (siehe oben). 1500 W sind nicht deckbar.
test('Vorlauftemperatur: nicht deckbar, wenn auch 75 °C nicht reichen', () => {
  const ergebnis = noetigeVorlauftemperatur({ heizkoerper: [standard()], heizlast: 1500, ...betrieb });
  wahr(ergebnis.status === 'nicht_deckbar', 'Status');
  gleich(ergebnis.leistungBeiMax, 1069.0, 0.5, 'Leistung bei 75 °C');
  wahr(ergebnis.vorlauf === undefined, 'keine Vorlauftemperatur ausgeben');
});

test('Vorlauftemperatur: Raum mit "Leistung fehlt" bekommt keine Vorlauftemperatur', () => {
  const heizkoerper = [standard('a'), standard('b', { phiN: null })];
  const ergebnis = noetigeVorlauftemperatur({ heizkoerper, heizlast: 300, ...betrieb });
  wahr(ergebnis.status === 'leistung_fehlt', 'Status');
  wahr(ergebnis.heizkoerperIds.join() === 'b', 'der Heizkörper ohne Leistung wird genannt');
  wahr(ergebnis.vorlauf === undefined, 'keine Vorlauftemperatur');
});

test('Vorlauftemperatur: ein entfallender Heizkörper ohne Leistung stört nicht', () => {
  const heizkoerper = [standard('a'), standard('b', { phiN: null, status: 'entfaellt' })];
  wahr(noetigeVorlauftemperatur({ heizkoerper, heizlast: 300, ...betrieb }).status === 'ok', 'Status ok');
});

test('Vorlauftemperatur: ohne aktiven Heizkörper', () => {
  wahr(noetigeVorlauftemperatur({ heizkoerper: [], heizlast: 300, ...betrieb }).status === 'kein_heizkoerper', 'leer');
  const nurAlt = [standard('a', { status: 'entfaellt' })];
  wahr(noetigeVorlauftemperatur({ heizkoerper: nurAlt, heizlast: 300, ...betrieb }).status === 'kein_heizkoerper', 'nur entfallend');
});

// Wärmepumpen-Heizkörper mit der Kennlinie von oben:
//   900 W: 600 + 40 · (t − 35) = 900 → t = 35 + 300 / 40 = 42,5 °C
//   500 W: schon bei der ersten Datenblattzeile (35 °C, 600 W) gedeckt; darunter gibt es keine Werte,
//          also höchstens 35 °C mit Hinweis auf die Untergrenze des Datenblatts
//   1500 W: die Kennlinie endet bei 55 °C mit 1400 W, darüber wird nicht extrapoliert → unbestimmt
test('Vorlauftemperatur mit Kennlinie: Interpolation, Untergrenze, Obergrenze', () => {
  const heizkoerper = [waermepumpe()];
  const normal = noetigeVorlauftemperatur({ heizkoerper, heizlast: 900, ...betrieb });
  gleich(normal.vorlauf, 42.5, 0.001, 'Vorlauf bei 900 W');

  const klein = noetigeVorlauftemperatur({ heizkoerper, heizlast: 500, ...betrieb });
  wahr(klein.status === 'ok' && klein.vorlauf === 35 && klein.untergrenzeDatenblatt === true, 'Untergrenze des Datenblatts');

  const gross = noetigeVorlauftemperatur({ heizkoerper, heizlast: 1500, ...betrieb });
  wahr(gross.status === 'unbestimmt', 'über dem Datenblattbereich wird nicht extrapoliert');
});

test('Installierte Leistung ist unbestimmt, wenn ein Heizkörper außerhalb seiner Datenblattwerte liegt', () => {
  const ergebnis = installierteLeistung([standard('a'), waermepumpe()], { tV: 60, ...betrieb });
  wahr(ergebnis.summe === null, 'Summe unbestimmt');
  wahr(ergebnis.ausserhalb.length === 1 && ergebnis.ausserhalb[0].id === 'wp1', 'der betroffene Heizkörper wird genannt');
  const innerhalb = installierteLeistung([standard('a'), waermepumpe()], { tV: 45, ...betrieb });
  gleich(innerhalb.summe, 353.78 + 1000, 0.05, 'Summe bei 45 °C');
});

// --- Bewertung der Räume und Zurechnung -------------------------------------------------------

const einstellungen = {
  thetaAussen: -8,
  dUWB: { min: 0.1, max: 0.1 },
  fg: 1,
  luftwechselStandard: { min: 0.5, max: 0.5 },
  aufheizzuschlag: { aktiv: false, wProM2: 0 },
};
const aussen = { art: 'aussen' };

// Raum B (beheizt, 20 °C, V = 30 m³) mit passivem Nachbarn P (15 °C, V = 25 m³).
//   B: Außenwand 10 m², U = 0,9: 10 · (0,9 + 0,1) · 28 = 280,00 W, Lüftung 0,34 · 0,5 · 30 · 28 = 142,80 W
//      eigene Heizlast 422,80 W
//   P: Außenwand 6 m², U = 0,8: 6 · (0,8 + 0,1) · 23 = 124,20 W, Lüftung 0,34 · 0,5 · 25 · 23 = 97,75 W
//      Netto-Verlust 221,95 W, vollständig B zugeordnet
//   Heizlast B mit Anteil = 422,80 + 221,95 = 644,75 W
function projektMitPassivem(verteilung) {
  return {
    einstellungen,
    zonen: [],
    raeume: [
      {
        id: 'b', name: 'B', status: 'beheizt', theta: 20, flaeche: 12, volumen: 30, luftwechsel: null,
        flaechen: [{ id: 'b-aussen', flaeche: 10, u: { min: 0.9, max: 0.9 }, angrenzend: aussen }],
      },
      {
        id: 'p', name: 'P', status: 'passiv', theta: 15, flaeche: 10, volumen: 25, luftwechsel: null,
        flaechen: [{ id: 'p-aussen', flaeche: 6, u: { min: 0.8, max: 0.8 }, angrenzend: aussen }],
        waermeLieferanten: verteilung,
      },
    ],
  };
}

const beheizte = (ergebnis) => ergebnis.raeume.filter((r) => r.status === 'beheizt');

// Test: zugerechneter Anteil eines passiven Raums erhöht die nötige Vorlauftemperatur.
//
// Heizkörper in B: 1000 W bei 75/65/20, n = 1,3, Spreizung 5 K. Vergleichswerte oben:
//   ohne Anteil: Heizlast 422,80 W liegt zwischen 353,8 W (45 °C) und 460,1 W (50 °C)
//                → Vorlauf zwischen 45 und 50 °C
//   mit Anteil:  Heizlast 644,75 W liegt zwischen 572,2 W (55 °C) und 689,7 W (60 °C)
//                → Vorlauf zwischen 55 und 60 °C
// Probe mit der Formel bei der gefundenen Temperatur t: Φ(t) muss der Heizlast entsprechen.
test('Zugerechneter Anteil eines passiven Raums erhöht die nötige Vorlauftemperatur', () => {
  const ohne = berechneGebaeude(projektMitPassivem([]));
  const mit = berechneGebaeude(projektMitPassivem([{ raumId: 'b', prozent: 100 }]));
  const hk = [{ ...standard('hk'), raumId: 'b' }];

  const zeileOhne = bewerteRaeume({ raeume: beheizte(ohne), heizkoerper: hk, spreizung: 5, zielVorlauf: 45 }).zeilen[0];
  const zeileMit = bewerteRaeume({ raeume: beheizte(mit), heizkoerper: hk, spreizung: 5, zielVorlauf: 45 }).zeilen[0];

  gleich(zeileOhne.heizlast, 422.80, 0.01, 'Heizlast ohne Anteil');
  gleich(zeileMit.heizlast, 644.75, 0.01, 'Heizlast mit Anteil');
  wahr(zeileOhne.vorlauf.vorlauf > 45 && zeileOhne.vorlauf.vorlauf < 50, `ohne Anteil zwischen 45 und 50 °C (${zeileOhne.vorlauf.vorlauf})`);
  wahr(zeileMit.vorlauf.vorlauf > 55 && zeileMit.vorlauf.vorlauf < 60, `mit Anteil zwischen 55 und 60 °C (${zeileMit.vorlauf.vorlauf})`);
  wahr(zeileMit.vorlauf.vorlauf - zeileOhne.vorlauf.vorlauf > 5, 'mit Anteil mindestens 5 K höher');

  for (const zeile of [zeileOhne, zeileMit]) {
    const t = zeile.vorlauf.vorlauf;
    const probe = heizkoerperLeistung(hk[0], { tV: t, tR: t - 5, ti: 20 }).leistung;
    gleich(probe, zeile.heizlast, 0.01, 'Probe: Leistung bei der gefundenen Temperatur gleich Heizlast');
  }
});

// Herkunft der Raumheizlast (Ergebnis-Tabelle): 644,75 W = 422,80 W eigene Verluste + 221,95 W aus dem passiven Raum.
test('Ergebnis-Tabelle zeigt Anteile aus passiven Räumen und aus Raum-zu-Raum-Verlusten', () => {
  const mit = berechneGebaeude(projektMitPassivem([{ raumId: 'b', prozent: 100 }]));
  const zeile = bewerteRaeume({ raeume: beheizte(mit), heizkoerper: [], spreizung: 5, zielVorlauf: 45 }).zeilen[0];
  gleich(zeile.davonPassiv, 221.95, 0.01, 'davon passiv');
  gleich(zeile.davonRaumZuRaum, 0, 1e-9, 'davon Raum-zu-Raum');

  // Bad (22 °C) neben R1 (20 °C) wie in Beispiel E: das Bad erhält 8 · 1,5 · 2 = 24,00 W Raum-zu-Raum-Verlust.
  const e = berechneGebaeude({
    einstellungen,
    raeume: [
      {
        id: 'bad', name: 'Bad', status: 'beheizt', theta: 22, flaeche: 6, volumen: 15, luftwechsel: null,
        flaechen: [
          { id: 'bad-aussen', flaeche: 5, u: { min: 1.2, max: 1.2 }, angrenzend: aussen },
          { id: 'bad-r1', flaeche: 8, u: { min: 1.5, max: 1.5 }, angrenzend: { art: 'raum', raumId: 'r1' } },
        ],
      },
      {
        id: 'r1', name: 'R1', status: 'beheizt', theta: 20, flaeche: 16, volumen: 40, luftwechsel: null,
        flaechen: [{ id: 'r1-aussen', flaeche: 10, u: { min: 1.0, max: 1.0 }, angrenzend: aussen }],
      },
    ],
  });
  const zeilen = bewerteRaeume({ raeume: beheizte(e), heizkoerper: [], spreizung: 5, zielVorlauf: 45 }).zeilen;
  gleich(zeilen[0].davonRaumZuRaum, 24.00, 1e-9, 'Bad: davon Raum-zu-Raum');
  gleich(zeilen[0].davonPassiv, 0, 1e-9, 'Bad: davon passiv');
  gleich(zeilen[1].davonRaumZuRaum, 0, 1e-9, 'R1: davon Raum-zu-Raum');
  gleich(zeilen[0].heizlast, 295.50, 0.01, 'Bad: Heizlast');
});

// Bei 45 °C leistet der Heizkörper 353,8 W. Heizlast 400 W: Unterdeckung 353,8 − 400 = −46,2 W, Deckung 88,4 %.
test('Ziel-Vorlauftemperatur: installierte Leistung, Deckungsgrad, Über-/Unterdeckung', () => {
  const raum = { id: 'r', name: 'R', theta: 20, guenstig: { heizlast: 400, raumZuRaumSumme: 0, zugeteilt: 0 }, ungunstig: { heizlast: 400, raumZuRaumSumme: 0, zugeteilt: 0 } };
  const zeile = bewerteRaeume({ raeume: [raum], heizkoerper: [{ ...standard(), raumId: 'r' }], spreizung: 5, zielVorlauf: 45 }).zeilen[0];
  gleich(zeile.installiert, 353.78, 0.05, 'installiert bei 45 °C');
  gleich(zeile.deckung, 88.4, 0.1, 'Deckungsgrad');
  gleich(zeile.differenz, -46.2, 0.1, 'Unterdeckung');
  const hoeher = bewerteRaeume({ raeume: [raum], heizkoerper: [{ ...standard(), raumId: 'r' }], spreizung: 5, zielVorlauf: 60 }).zeilen[0];
  gleich(hoeher.differenz, 689.65 - 400, 0.1, 'Überdeckung bei 60 °C');
});

// Zwei Räume: R1 braucht 460,05 W (50 °C), R2 braucht 572,22 W (55 °C) → R2 ist der bestimmende Raum.
test('Bestimmender Raum ist der mit der höchsten nötigen Vorlauftemperatur', () => {
  const raum = (id, heizlast) => ({
    id, name: id, theta: 20,
    guenstig: { heizlast, raumZuRaumSumme: 0, zugeteilt: 0 }, ungunstig: { heizlast, raumZuRaumSumme: 0, zugeteilt: 0 },
  });
  const ergebnis = bewerteRaeume({
    raeume: [raum('r1', 460.05), raum('r2', 572.22)],
    heizkoerper: [{ ...standard('h1'), raumId: 'r1' }, { ...standard('h2'), raumId: 'r2' }],
    spreizung: 5, zielVorlauf: 45,
  });
  wahr(ergebnis.bestimmendId === 'r2', 'bestimmender Raum ist r2');
  wahr(ergebnis.zeilen.find((z) => z.raumId === 'r2').bestimmend && !ergebnis.zeilen.find((z) => z.raumId === 'r1').bestimmend, 'nur r2 markiert');
});

test('Nicht deckbarer Raum ist bestimmend, Raum ohne Leistung macht die Rangfolge unsicher', () => {
  const raum = (id, heizlast) => ({
    id, name: id, theta: 20,
    guenstig: { heizlast, raumZuRaumSumme: 0, zugeteilt: 0 }, ungunstig: { heizlast, raumZuRaumSumme: 0, zugeteilt: 0 },
  });
  const ergebnis = bewerteRaeume({
    raeume: [raum('ok', 460), raum('zuviel', 1500), raum('fehlt', 300)],
    heizkoerper: [
      { ...standard('a'), raumId: 'ok' }, { ...standard('b'), raumId: 'zuviel' }, { ...standard('c', { phiN: null }), raumId: 'fehlt' },
    ],
    spreizung: 5, zielVorlauf: 45,
  });
  wahr(ergebnis.bestimmendId === 'zuviel', 'nicht deckbarer Raum geht vor');
  wahr(ergebnis.unsicher.join() === 'fehlt', 'Raum ohne Leistung ist unsicher');
  const fehlt = ergebnis.zeilen.find((z) => z.raumId === 'fehlt');
  wahr(fehlt.vorlauf.status === 'leistung_fehlt' && fehlt.hinweise.some((h) => h.art === 'leistung_fehlt'), 'Hinweis "Leistung fehlt"');
  wahr(fehlt.installiert === null && fehlt.deckung === null, 'keine installierte Leistung erfunden');
});

test('Hinweise: altes Ventil und abweichende Bezugstemperatur beim Wärmepumpen-Heizkörper', () => {
  const raum = {
    id: 'r', name: 'R', theta: 22,
    guenstig: { heizlast: 900, raumZuRaumSumme: 0, zugeteilt: 0 }, ungunstig: { heizlast: 900, raumZuRaumSumme: 0, zugeteilt: 0 },
  };
  const hk = [
    { ...standard('alt', { ventil: 'alt' }), raumId: 'r' },
    { ...waermepumpe('wp'), raumId: 'r' }, // Datenblatt gilt für 20 °C, der Raum hat 22 °C
  ];
  const zeile = bewerteRaeume({ raeume: [raum], heizkoerper: hk, spreizung: 5, zielVorlauf: 45 }).zeilen[0];
  wahr(zeile.hinweise.some((h) => h.art === 'altes_ventil' && h.heizkoerperIds.join() === 'alt'), 'Hinweis altes Ventil');
  wahr(zeile.hinweise.some((h) => h.art === 'bezugstemperatur_abweichend' && h.heizkoerperIds.join() === 'wp'), 'Hinweis Bezugstemperatur');
  // Das alte Ventil ändert die Leistung nicht. Bei 22 °C Raumtemperatur und 45/40:
  //   Standard-Heizkörper: ΔT_log = 5 / ln(23/18) = 20,398 K → (20,398 / 49,833)^1,3 = 0,3131 → 313,1 W
  //   Wärmepumpen-Heizkörper bei 45 °C laut Kennlinie: 1000 W (die Kennlinie wird nicht umgerechnet)
  //   Summe 1313,1 W
  gleich(zeile.installiert, 313.1 + 1000, 0.1, 'Leistung unverändert durch das Ventil');
});
