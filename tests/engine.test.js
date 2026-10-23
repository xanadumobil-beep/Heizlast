// Tests für den Rechenkern. Jede Erwartung ist von Hand nachgerechnet,
// die Handrechnung steht direkt beim Test.

import { test, gleich, wahr } from './runner.js';
import { berechneGebaeude } from '../js/engine/heatload.js';
import { leistungBeiBedingung } from '../js/engine/radiator.js';
import { parseDezimal, formatZahl } from '../js/engine/format.js';

// Grundeinstellungen für alle Tests. Einzelne Werte werden pro Test überschrieben.
const basis = {
  thetaAussen: -8,
  dUWB: { min: 0.1, max: 0.1 },
  fg: 1,
  luftwechselStandard: { min: 0.5, max: 0.5 },
  aufheizzuschlag: { aktiv: false, wProM2: 0 },
};

const aussen = { art: 'aussen' };

// --- Beispiel A: Außenwand mit Fenster ---------------------------------------
// Wand 4,00 × 2,50 = 10,00 m², Fenster 1,20 × 1,40 = 1,68 m², Uw = 1,3.
// U_Wand = 1,2, ΔU_WB = 0,10, θ_i = 20, θ_e = −8, ΔT = 28 K.
// Wand:      (10,00 − 1,68) · (1,2 + 0,1) · 28 = 302,85 W
// Fenster:    1,68 · (1,3 + 0,1) · 28          =  65,86 W
// Keine Lüftung (Volumen 0).
test('Beispiel A: Außenwand mit Fenster', () => {
  const ergebnis = berechneGebaeude({
    einstellungen: basis,
    raeume: [
      {
        id: 'r1', name: 'Raum A', status: 'beheizt', theta: 20, flaeche: 10, volumen: 0,
        luftwechsel: { min: 0, max: 0 },
        flaechen: [
          {
            id: 'wand', flaeche: 10, u: { min: 1.2, max: 1.2 }, angrenzend: aussen,
            oeffnungen: [{ flaeche: 1.68, uw: 1.3 }],
          },
        ],
      },
    ],
  });
  const raum = ergebnis.raeume[0].guenstig;
  gleich(raum.wand, 302.85, 0.01, 'Wand');
  gleich(raum.oeffnungen, 65.86, 0.01, 'Fenster');
  gleich(raum.heizlast, 368.71, 0.01, 'Summe');
});

// --- Beispiel A mit Bandbreite ------------------------------------------------
// ΔU_WB 0,05 / 0,15, U-Wert 1,0 / 1,4, Uw 1,3 (ohne Bandbreite).
// günstig:   Wand 8,32 · (1,0 + 0,05) · 28 = 244,61 W, Fenster 1,68 · (1,3 + 0,05) · 28 = 63,50 W
// ungünstig: Wand 8,32 · (1,4 + 0,15) · 28 = 361,09 W, Fenster 1,68 · (1,3 + 0,15) · 28 = 68,21 W
// Mittel:    (308,11 + 429,30) / 2 = 368,70 W
test('Beispiel A mit Bandbreite (ΔU_WB und U-Wert)', () => {
  const ergebnis = berechneGebaeude({
    einstellungen: { ...basis, dUWB: { min: 0.05, max: 0.15 } },
    raeume: [
      {
        id: 'r1', name: 'Raum A', status: 'beheizt', theta: 20, flaeche: 10, volumen: 0,
        luftwechsel: { min: 0, max: 0 },
        flaechen: [
          {
            id: 'wand', flaeche: 10, u: { min: 1.0, max: 1.4 }, angrenzend: aussen,
            oeffnungen: [{ flaeche: 1.68, uw: 1.3 }],
          },
        ],
      },
    ],
  });
  const r = ergebnis.raeume[0];
  gleich(r.guenstig.heizlast, 308.11, 0.01, 'günstig');
  gleich(r.ungunstig.heizlast, 429.30, 0.01, 'ungünstig');
  gleich(r.mittel.heizlast, 368.70, 0.01, 'Mittel');
});

// --- Beispiel B: Raum mit Erdreich und Lüftung --------------------------------
// Raum 4,00 × 3,00 m, Höhe 2,50 m, V = 30,0 m³, n = 0,5, θ_i = 20.
// Lüftung: 0,34 · 0,5 · 30,0 · 28 = 142,80 W
// Erdreich: Fläche 12,0 m², U = 0,4, ΔU_WB = 0,10, f_g = 1, θ_Erdreich = 10 °C.
//           12,0 · (0,4 + 0,1) · 1 · (20 − 10) = 60,00 W
// Summe: 202,80 W
test('Beispiel B: Raum mit Erdreich und Lüftung', () => {
  const ergebnis = berechneGebaeude({
    einstellungen: basis,
    zonen: [{ id: 'erd', art: 'erdreich', temperatur: { min: 10, max: 10 } }],
    raeume: [
      {
        id: 'r1', name: 'Keller-Raum', status: 'beheizt', theta: 20, flaeche: 12, volumen: 30,
        luftwechsel: null,
        flaechen: [
          { id: 'boden', flaeche: 12, u: { min: 0.4, max: 0.4 }, angrenzend: { art: 'zone', zoneId: 'erd' } },
        ],
      },
    ],
  });
  const raum = ergebnis.raeume[0].guenstig;
  gleich(raum.lueftung, 142.80, 0.01, 'Lüftung');
  gleich(raum.wand, 60.00, 0.01, 'Erdreich');
  gleich(raum.heizlast, 202.80, 0.01, 'Summe');
});

// --- Beispiel C: Heizkörper bei 45/40/20 aus Normleistung bei 75/65/20 --------
// ΔT_log,n = 10 / ln(55/45) = 49,83 K
// ΔT_log   =  5 / ln(25/20) = 22,41 K
// Verhältnis 0,4497, hoch 1,3 ergibt 0,3538 → 1000 W · 0,3538 = 353,8 W
test('Beispiel C: Heizkörperleistung bei 45/40/20', () => {
  const hk = { phiN: 1000, n: 1.3, norm: { tV: 75, tR: 65, ti: 20 } };
  gleich(leistungBeiBedingung(hk, { tV: 45, tR: 40, ti: 20 }), 353.8, 0.5, 'Leistung');
});

test('Heizkörper liefert bei Normbedingung genau die Normleistung', () => {
  const hk = { phiN: 1000, n: 1.3, norm: { tV: 75, tR: 65, ti: 20 } };
  gleich(leistungBeiBedingung(hk, { tV: 75, tR: 65, ti: 20 }), 1000, 1e-6, 'Norm');
});

test('Heizkörper mit Spreizung 0 ist kein Sonderfall, der abstürzt', () => {
  const hk = { phiN: 1000, n: 1.3, norm: { tV: 75, tR: 65, ti: 20 } };
  const leistung = leistungBeiBedingung(hk, { tV: 40, tR: 40, ti: 20 });
  wahr(leistung > 0 && leistung < 1000, 'Leistung bei Spreizung 0 muss plausibel sein');
});

// --- Bandbreite Erdreich ------------------------------------------------------
// Erdreich 8 / 12 °C, Fläche 12 m², U = 0,4, ΔU_WB = 0,10, θ_i = 20, f_g = 1.
// günstig (Erdreich 12 °C): 12 · 0,5 · 8 = 48,00 W
// ungünstig (Erdreich 8 °C): 12 · 0,5 · 12 = 72,00 W
test('Bandbreite: Erdreichtemperatur 8 bis 12 °C', () => {
  const ergebnis = berechneGebaeude({
    einstellungen: basis,
    zonen: [{ id: 'erd', art: 'erdreich', temperatur: { min: 8, max: 12 } }],
    raeume: [
      {
        id: 'r1', name: 'R', status: 'beheizt', theta: 20, flaeche: 12, volumen: 0,
        luftwechsel: { min: 0, max: 0 },
        flaechen: [{ id: 'b', flaeche: 12, u: { min: 0.4, max: 0.4 }, angrenzend: { art: 'zone', zoneId: 'erd' } }],
      },
    ],
  });
  gleich(ergebnis.raeume[0].guenstig.heizlast, 48.00, 0.01, 'günstig');
  gleich(ergebnis.raeume[0].ungunstig.heizlast, 72.00, 0.01, 'ungünstig');
});

// --- Bandbreite Luftwechsel ---------------------------------------------------
// V = 30 m³, θ_i = 20, θ_e = −8, ΔT = 28 K.
// günstig (n = 0,5):   0,34 · 0,5 · 30 · 28 = 142,80 W
// ungünstig (n = 1,0): 0,34 · 1,0 · 30 · 28 = 285,60 W
test('Bandbreite: Luftwechsel 0,5 bis 1,0', () => {
  const ergebnis = berechneGebaeude({
    einstellungen: basis,
    raeume: [
      {
        id: 'r1', name: 'R', status: 'beheizt', theta: 20, flaeche: 10, volumen: 30,
        luftwechsel: { min: 0.5, max: 1.0 }, flaechen: [],
      },
    ],
  });
  gleich(ergebnis.raeume[0].guenstig.lueftung, 142.80, 0.01, 'günstig');
  gleich(ergebnis.raeume[0].ungunstig.lueftung, 285.60, 0.01, 'ungünstig');
});

// --- Beispiel D: zwei beheizte Räume, passiver Raum, unbeheizte Zone ----------
//
// Gemeinsame Eingaben (günstig und ungünstig sind gleich, weil überall Min = Max):
//   θ_e = −8 °C, ΔU_WB = 0,10 W/(m²K), f_g = 1, Luftwechsel n = 0,5 h⁻¹, Aufheizzuschlag aus
//   Zone "Keller" (unbeheizt): 5 °C, Zone "Erdreich": 10 °C
//
// B1 (beheizt, θ = 20 °C, Fläche 16 m², V = 40 m³)
//   Außenwand 10 m², U = 1,0 W/(m²K), ΔT = 20 − (−8) = 28 K
//     10 · (1,0 + 0,1) · 28                   = 308,00 W
//   Lüftung 0,34 · 0,5 · 40 · 28              = 190,40 W
//   Innenwand zu B2 (6 m²) und zu P (4 m²)    =   0,00 W  (Raum-zu-Raum, intern)
//   Eigener Netto-Verlust                     = 498,40 W
//
// B2 (beheizt, θ = 20 °C, Fläche 8 m², V = 30 m³)
//   Wand zum Keller 8 m², U = 1,2, ΔT = 20 − 5 = 15 K
//     8 · (1,2 + 0,1) · 15                    = 156,00 W
//   Lüftung 0,34 · 0,5 · 30 · 28              = 142,80 W
//   Innenwand zu B1 (6 m²)                    =   0,00 W
//   Eigener Netto-Verlust                     = 298,80 W
//
// P (passiv, θ = 15 °C, Fläche 10 m², V = 25 m³)
//   Außenwand 6 m², U = 0,8, ΔT = 15 − (−8) = 23 K
//     6 · (0,8 + 0,1) · 23                    = 124,20 W
//   Boden zum Erdreich 4 m², U = 0,5, ΔT = 15 − 10 = 5 K
//     4 · (0,5 + 0,1) · 1 · 5                 =  12,00 W
//   Lüftung 0,34 · 0,5 · 25 · 23              =  97,75 W
//   Innenwand zu B1 (4 m²)                    =   0,00 W
//   Netto-Verlust                             = 233,95 W
//
// Verteilung von P: B1 60 %, B2 40 %
//   B1 erhält 0,6 · 233,95 = 140,37 W   → Heizlast B1 = 498,40 + 140,37 = 638,77 W
//   B2 erhält 0,4 · 233,95 =  93,58 W   → Heizlast B2 = 298,80 +  93,58 = 392,38 W
//
// Gebäudesumme direkt (Flächen an Außenluft, Erdreich, unbeheizte Zone + Lüftung):
//   Hülle:   308,00 (B1 außen) + 156,00 (B2 Keller) + 124,20 (P außen) + 12,00 (P Erdreich) = 600,20 W
//   Lüftung: 190,40 + 142,80 + 97,75                                                          = 430,95 W
//   Summe                                                                                     = 1031,15 W
// Gegenprobe: 638,77 + 392,38 = 1031,15 W, Differenz 0 W.
function beispielD({ einstellungen = basis, verteilung = [{ raumId: 'b1', prozent: 60 }, { raumId: 'b2', prozent: 40 }] } = {}) {
  return {
    einstellungen,
    zonen: [
      { id: 'keller', art: 'unbeheizt', temperatur: { min: 5, max: 5 } },
      { id: 'erd', art: 'erdreich', temperatur: { min: 10, max: 10 } },
    ],
    raeume: [
      {
        id: 'b1', name: 'B1', status: 'beheizt', theta: 20, flaeche: 16, volumen: 40, luftwechsel: null,
        flaechen: [
          { id: 'b1-aussen', flaeche: 10, u: { min: 1.0, max: 1.0 }, angrenzend: aussen },
          { id: 'b1-b2', flaeche: 6, u: { min: 1.0, max: 1.0 }, angrenzend: { art: 'raum', raumId: 'b2' } },
          { id: 'b1-p', flaeche: 4, u: { min: 1.0, max: 1.0 }, angrenzend: { art: 'raum', raumId: 'p' } },
        ],
      },
      {
        id: 'b2', name: 'B2', status: 'beheizt', theta: 20, flaeche: 8, volumen: 30, luftwechsel: null,
        flaechen: [
          { id: 'b2-keller', flaeche: 8, u: { min: 1.2, max: 1.2 }, angrenzend: { art: 'zone', zoneId: 'keller' } },
          { id: 'b2-b1', flaeche: 6, u: { min: 1.0, max: 1.0 }, angrenzend: { art: 'raum', raumId: 'b1' } },
        ],
      },
      {
        id: 'p', name: 'P', status: 'passiv', theta: 15, flaeche: 10, volumen: 25, luftwechsel: null,
        flaechen: [
          { id: 'p-aussen', flaeche: 6, u: { min: 0.8, max: 0.8 }, angrenzend: aussen },
          { id: 'p-erd', flaeche: 4, u: { min: 0.5, max: 0.5 }, angrenzend: { art: 'zone', zoneId: 'erd' } },
          { id: 'p-b1', flaeche: 4, u: { min: 1.0, max: 1.0 }, angrenzend: { art: 'raum', raumId: 'b1' } },
        ],
        waermeLieferanten: verteilung,
      },
    ],
  };
}

test('Beispiel D: Gebäudesumme ohne Doppelzählung, passive Zurechnung', () => {
  const ergebnis = berechneGebaeude(beispielD());
  const [r1, r2, rp] = ergebnis.raeume;

  for (const fall of ['guenstig', 'ungunstig']) {
    gleich(r1[fall].netto, 498.40, 0.01, `${fall} B1 eigen`);
    gleich(r2[fall].netto, 298.80, 0.01, `${fall} B2 eigen`);
    gleich(rp[fall].netto, 233.95, 0.01, `${fall} P netto`);
    gleich(r1[fall].zugeteilt, 140.37, 0.01, `${fall} B1 erhält`);
    gleich(r2[fall].zugeteilt, 93.58, 0.01, `${fall} B2 erhält`);
    gleich(r1[fall].heizlast, 638.77, 0.01, `${fall} B1 Heizlast`);
    gleich(r2[fall].heizlast, 392.38, 0.01, `${fall} B2 Heizlast`);

    const gebaeude = ergebnis.gebaeude[fall];
    gleich(gebaeude.huelle, 600.20, 0.01, `${fall} Hülle`);
    gleich(gebaeude.lueftung, 430.95, 0.01, `${fall} Lüftung`);
    gleich(gebaeude.summe, 1031.15, 0.01, `${fall} Gebäudesumme direkt`);
    gleich(gebaeude.heizlast, 1031.15, 0.01, `${fall} Summe Raumheizlasten`);
    gleich(gebaeude.differenz, 0, 0.001, `${fall} Differenz`);
  }
  wahr(ergebnis.warnungen.length === 0, `unerwartete Warnungen: ${JSON.stringify(ergebnis.warnungen)}`);
});

// Verteilung nur 80 % (B1 50 %, B2 30 %): 20 % des passiven Netto-Verlusts fehlen in den Raumheizlasten.
//   B1 erhält 0,5 · 233,95 = 116,975 W → Heizlast B1 = 498,40 + 116,975 = 615,375 W
//   B2 erhält 0,3 · 233,95 =  70,185 W → Heizlast B2 = 298,80 +  70,185 = 368,985 W
//   Summe Raumheizlasten = 984,36 W, Gebäudesumme direkt unverändert 1031,15 W
//   Differenz = 1031,15 − 984,36 = 46,79 W (= 0,2 · 233,95), also über 1 W: Warnung
test('Verteilung nur 80 %: Gegenprobe zeigt Differenz von 46,79 W', () => {
  const ergebnis = berechneGebaeude(
    beispielD({ verteilung: [{ raumId: 'b1', prozent: 50 }, { raumId: 'b2', prozent: 30 }] }),
  );
  for (const fall of ['guenstig', 'ungunstig']) {
    const gebaeude = ergebnis.gebaeude[fall];
    gleich(gebaeude.summe, 1031.15, 0.01, `${fall} Gebäudesumme direkt`);
    gleich(gebaeude.heizlast, 984.36, 0.01, `${fall} Summe Raumheizlasten`);
    gleich(gebaeude.differenz, 46.79, 0.01, `${fall} Differenz`);
    const warnung = ergebnis.warnungen.find((w) => w.art === 'gegenprobe' && w.fall === fall);
    wahr(warnung !== undefined, `${fall}: Warnung Gegenprobe fehlt`);
    gleich(warnung.differenz, 46.79, 0.01, `${fall} Differenz in der Warnung`);
  }
  wahr(ergebnis.warnungen.some((w) => w.art === 'passiv_verteilung' && w.raumId === 'p'), 'Verteilungswarnung fehlt');
});

// Abweichung bis 1 W löst keine Warnung aus.
//   Verteilung 99,5 %: Differenz = 0,005 · 233,95 = 1,17 W → Warnung (über 1 W)
//   Verteilung 99,9 %: Differenz = 0,001 · 233,95 = 0,23 W → keine Gegenprobe-Warnung
test('Gegenprobe: Schwelle liegt bei 1 W', () => {
  const knapp = berechneGebaeude(
    beispielD({ verteilung: [{ raumId: 'b1', prozent: 59.9 }, { raumId: 'b2', prozent: 40 }] }),
  );
  gleich(knapp.gebaeude.guenstig.differenz, 0.23, 0.01, 'Differenz 99,9 %');
  wahr(!knapp.warnungen.some((w) => w.art === 'gegenprobe'), 'bei 0,23 W darf keine Gegenprobe-Warnung kommen');

  const deutlich = berechneGebaeude(
    beispielD({ verteilung: [{ raumId: 'b1', prozent: 59.5 }, { raumId: 'b2', prozent: 40 }] }),
  );
  gleich(deutlich.gebaeude.guenstig.differenz, 1.17, 0.01, 'Differenz 99,5 %');
  wahr(deutlich.warnungen.some((w) => w.art === 'gegenprobe'), 'bei 1,17 W muss die Gegenprobe-Warnung kommen');
});

// Aufheizzuschlag 10 W/m² auf beheizte und passive Räume: 10 · (16 + 8 + 10) = 340 W mehr.
//   Gebäudesumme direkt = 1031,15 + 340 = 1371,15 W, Gegenprobe ohne Differenz.
test('Aufheizzuschlag geht in Gebäudesumme und Raumheizlasten gleich ein', () => {
  const ergebnis = berechneGebaeude(
    beispielD({ einstellungen: { ...basis, aufheizzuschlag: { aktiv: true, wProM2: 10 } } }),
  );
  gleich(ergebnis.gebaeude.guenstig.summe, 1371.15, 0.01, 'Gebäudesumme');
  gleich(ergebnis.gebaeude.guenstig.heizlast, 1371.15, 0.01, 'Summe Raumheizlasten');
  gleich(ergebnis.gebaeude.guenstig.differenz, 0, 0.001, 'Differenz');
});

test('Passiver Raum ohne vollständige Verteilung erzeugt eine Warnung', () => {
  const ergebnis = berechneGebaeude({
    einstellungen: basis,
    raeume: [
      { id: 'b1', name: 'B1', status: 'beheizt', theta: 20, flaeche: 10, volumen: 10, luftwechsel: null, flaechen: [] },
      {
        id: 'p', name: 'P', status: 'passiv', theta: 15, flaeche: 10, volumen: 10, luftwechsel: null,
        flaechen: [{ id: 'pw', flaeche: 10, u: { min: 1, max: 1 }, angrenzend: aussen }],
        waermeLieferanten: [{ raumId: 'b1', prozent: 80 }],
      },
    ],
  });
  wahr(ergebnis.warnungen.some((w) => w.art === 'passiv_verteilung' && w.raumId === 'p'), 'Warnung fehlt');
});

// --- Eingabe im deutschen Format ----------------------------------------------
test('Dezimalkomma wird als Zahl gelesen', () => {
  gleich(parseDezimal('1,5'), 1.5, 1e-9, '1,5');
  gleich(parseDezimal('1.5'), 1.5, 1e-9, '1.5');
  gleich(parseDezimal('-8'), -8, 1e-9, '-8');
  wahr(parseDezimal('abc') !== parseDezimal('abc'), 'ungültige Eingabe muss NaN sein');
  wahr(parseDezimal('') === null, 'leere Eingabe muss null sein');
});

test('Anzeige mit Dezimalkomma', () => {
  wahr(formatZahl(368.7, 1) === '368,7', 'Anzeige 368,7 erwartet');
});
