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

// --- Beispiel E: Raum-zu-Raum bei unterschiedlicher Temperatur ----------------
//
// Regel: Ein Raum verliert Wärme an einen kälteren Nachbarraum, A · U · (θ_i − θ_Nachbar), ohne ΔU_WB.
// Das wird seiner Raumheizlast angerechnet. Gewinne aus einem wärmeren Nachbarn gibt es nicht.
// In der Gebäudesumme erscheinen diese Ströme nicht.
//
// Gemeinsame Eingaben: θ_e = −8 °C, ΔU_WB = 0,10, f_g = 1, n = 0,5 h⁻¹, Aufheizzuschlag aus.
//
// Bad (beheizt, θ = 22 °C, Fläche 6 m², Höhe 2,5 m → V = 15 m³)
//   Außenwand 5 m², U = 1,2, ΔT = 22 + 8 = 30 K
//     5 · (1,2 + 0,1) · 30                      = 195,00 W
//   Lüftung 0,34 · 0,5 · 15 · 30                =  76,50 W
//   Innenwand zu R1: 8 m², U = 1,5, ΔT = 22 − 20 = 2 K, ohne ΔU_WB
//     8 · 1,5 · 2                               =  24,00 W   ← Raum-zu-Raum, wird angerechnet
//   Heizlast Bad = 195,00 + 76,50 + 24,00       = 295,50 W
//
// R1 (beheizt, θ = 20 °C, Fläche 16 m², V = 40 m³)
//   Außenwand 10 m², U = 1,0, ΔT = 28 K
//     10 · (1,0 + 0,1) · 28                     = 308,00 W
//   Lüftung 0,34 · 0,5 · 40 · 28                = 190,40 W
//   Innenwand zum wärmeren Bad                  =   0,00 W   ← keine Gutschrift
//   Heizlast R1 = 308,00 + 190,40               = 498,40 W
//
// Gebäudesumme direkt (ohne Raum-zu-Raum): 195,00 + 76,50 + 308,00 + 190,40 = 769,90 W
// Summe der Raumheizlasten: 295,50 + 498,40 = 793,90 W (um die 24 W größer als die Gebäudesumme)
// Gegenprobe: 769,90 + 24,00 − 793,90 = 0 W, keine Warnung.
function beispielE({ innenU = { min: 1.5, max: 1.5 }, r1ListetWand = false } = {}) {
  const r1Flaechen = [{ id: 'r1-aussen', flaeche: 10, u: { min: 1.0, max: 1.0 }, angrenzend: aussen }];
  if (r1ListetWand) {
    // Dieselbe Wand, von der anderen Seite geführt.
    r1Flaechen.push({ id: 'r1-bad', flaeche: 8, u: innenU, angrenzend: { art: 'raum', raumId: 'bad' } });
  }
  return {
    einstellungen: basis,
    raeume: [
      {
        id: 'bad', name: 'Bad', status: 'beheizt', theta: 22, flaeche: 6, volumen: 15, luftwechsel: null,
        flaechen: [
          { id: 'bad-aussen', flaeche: 5, u: { min: 1.2, max: 1.2 }, angrenzend: aussen },
          { id: 'bad-r1', flaeche: 8, u: innenU, angrenzend: { art: 'raum', raumId: 'r1' } },
        ],
      },
      {
        id: 'r1', name: 'R1', status: 'beheizt', theta: 20, flaeche: 16, volumen: 40, luftwechsel: null,
        flaechen: r1Flaechen,
      },
    ],
  };
}

test('Beispiel E: Bad erhält 24 W zusätzlich, R1 bekommt keine Gutschrift', () => {
  const ergebnis = berechneGebaeude(beispielE());
  const [bad, r1] = ergebnis.raeume;
  for (const fall of ['guenstig', 'ungunstig']) {
    gleich(bad[fall].raumZuRaumSumme, 24.00, 0.001, `${fall} Bad Raum-zu-Raum`);
    gleich(bad[fall].heizlast, 295.50, 0.01, `${fall} Bad Heizlast`);
    gleich(r1[fall].raumZuRaumSumme, 0, 0.001, `${fall} R1 Raum-zu-Raum`);
    gleich(r1[fall].heizlast, 498.40, 0.01, `${fall} R1 Heizlast`);

    const gebaeude = ergebnis.gebaeude[fall];
    gleich(gebaeude.summe, 769.90, 0.01, `${fall} Gebäudesumme`);
    gleich(gebaeude.raumZuRaum, 24.00, 0.001, `${fall} Raum-zu-Raum gesamt`);
    gleich(gebaeude.heizlast, 793.90, 0.01, `${fall} Summe Raumheizlasten`);
    gleich(gebaeude.differenz, 0, 0.001, `${fall} Differenz`);
  }
  // Die Liste der angerechneten Verluste zeigt Fläche, Nachbar und Leistung.
  wahr(bad.guenstig.raumZuRaum.length === 1, 'genau ein angerechneter Verlust beim Bad');
  wahr(bad.guenstig.raumZuRaum[0].nachbarId === 'r1' && bad.guenstig.raumZuRaum[0].flaecheId === 'bad-r1', 'Nachbar und Fläche');
  wahr(r1.guenstig.raumZuRaum.length === 0, 'R1 hat keinen angerechneten Verlust');
  wahr(ergebnis.warnungen.length === 0, `unerwartete Warnungen: ${JSON.stringify(ergebnis.warnungen)}`);
});

// Wird die Wand in beiden Räumen geführt, zählt nur der Eintrag im wärmeren Raum.
// R1 führt die Fläche zum wärmeren Bad: 0 W, kein Doppelzählen, kein Gutschreiben.
test('Beispiel E: Wand in beiden Räumen geführt zählt nur im wärmeren Raum', () => {
  const ergebnis = berechneGebaeude(beispielE({ r1ListetWand: true }));
  const [bad, r1] = ergebnis.raeume;
  gleich(bad.guenstig.heizlast, 295.50, 0.01, 'Bad Heizlast');
  gleich(r1.guenstig.heizlast, 498.40, 0.01, 'R1 Heizlast');
  gleich(ergebnis.gebaeude.guenstig.differenz, 0, 0.001, 'Differenz');
  const nicht = r1.guenstig.nichtAngerechnet.find((n) => n.flaecheId === 'r1-bad');
  wahr(nicht && nicht.grund === 'nachbar_waermer', 'R1 muss die Fläche als "Nachbar wärmer" führen');
  wahr(ergebnis.warnungen.length === 0, 'keine Warnung erwartet');
});

// Bandbreite beim Innenbauteil: U = 1,0 bis 2,0.
// günstig:   8 · 1,0 · 2 = 16,00 W → Bad 195,00 + 76,50 + 16,00 = 287,50 W
// ungünstig: 8 · 2,0 · 2 = 32,00 W → Bad 195,00 + 76,50 + 32,00 = 303,50 W
test('Beispiel E mit Bandbreite beim Innenbauteil', () => {
  const ergebnis = berechneGebaeude(beispielE({ innenU: { min: 1.0, max: 2.0 } }));
  const bad = ergebnis.raeume[0];
  gleich(bad.guenstig.heizlast, 287.50, 0.01, 'günstig');
  gleich(bad.ungunstig.heizlast, 303.50, 0.01, 'ungünstig');
  gleich(ergebnis.gebaeude.guenstig.raumZuRaum, 16.00, 0.001, 'Raum-zu-Raum günstig');
  gleich(ergebnis.gebaeude.ungunstig.raumZuRaum, 32.00, 0.001, 'Raum-zu-Raum ungünstig');
  gleich(ergebnis.gebaeude.guenstig.differenz, 0, 0.001, 'Differenz günstig');
  gleich(ergebnis.gebaeude.ungunstig.differenz, 0, 0.001, 'Differenz ungünstig');
  wahr(ergebnis.warnungen.length === 0, 'keine Warnung erwartet');
});

test('Raum-zu-Raum: Fläche zu passivem Raum zählt nicht (Zurechnung deckt ihn schon ab)', () => {
  // In Beispiel D ist B1 (20 °C) wärmer als P (15 °C) und führt eine Fläche zu P.
  const ergebnis = berechneGebaeude(beispielD());
  const b1 = ergebnis.raeume[0];
  gleich(b1.guenstig.raumZuRaumSumme, 0, 0.001, 'B1 Raum-zu-Raum');
  const nicht = b1.guenstig.nichtAngerechnet.find((n) => n.nachbarId === 'p');
  wahr(nicht && nicht.grund === 'nachbar_passiv', 'Grund "nachbar_passiv" erwartet');
});

// --- Gegenprobe zusammen mit Raum-zu-Raum-Verlusten ----------------------------
//
// Beispiel D mit B2 bei 22 °C (statt 20 °C):
//   B2: Keller 8 · 1,3 · 17 = 176,80 W, Lüftung 0,34 · 0,5 · 30 · 30 = 153,00 W,
//       Raum-zu-Raum zu B1: 6 m² · U 1,0 · (22 − 20) = 12,00 W → eigener Netto-Verlust 341,80 W
//   B1: unverändert 498,40 W (die Fläche zum wärmeren B2 zählt nicht, die zu P auch nicht)
//   P: unverändert 233,95 W; Verteilung 60 % / 40 %
//   Heizlast B1 = 498,40 + 140,37 = 638,77 W, Heizlast B2 = 341,80 + 93,58 = 435,38 W
//   Raumsumme = 1074,15 W
//   Gebäudesumme direkt: Hülle 308,00 + 176,80 + 124,20 + 12,00 = 621,00 W,
//                        Lüftung 190,40 + 153,00 + 97,75 = 441,15 W → 1062,15 W
//   Gegenprobe: 1062,15 + 12,00 − 1074,15 = 0 W
function beispielF(verteilung) {
  const eingabe = beispielD(verteilung ? { verteilung } : {});
  eingabe.raeume.find((r) => r.id === 'b2').theta = 22;
  return eingabe;
}

test('Gegenprobe mit Raum-zu-Raum: Raumsumme darf um die angerechneten Verluste größer sein', () => {
  const ergebnis = berechneGebaeude(beispielF());
  const g = ergebnis.gebaeude.guenstig;
  gleich(ergebnis.raeume[1].guenstig.raumZuRaumSumme, 12.00, 0.001, 'B2 Raum-zu-Raum');
  gleich(ergebnis.raeume[1].guenstig.heizlast, 435.38, 0.01, 'B2 Heizlast');
  gleich(g.summe, 1062.15, 0.01, 'Gebäudesumme direkt');
  gleich(g.heizlast, 1074.15, 0.01, 'Summe Raumheizlasten');
  wahr(g.heizlast > g.summe, 'Raumsumme ist größer als die Gebäudesumme');
  gleich(g.differenz, 0, 0.001, 'Differenz');
  wahr(ergebnis.warnungen.length === 0, `unerwartete Warnungen: ${JSON.stringify(ergebnis.warnungen)}`);
});

// Verteilung 99,5 %: es fehlen 0,005 · 233,95 = 1,17 W. Die Raumsumme (1072,98 W) liegt dann noch
// über der Gebäudesumme (1062,15 W), trotzdem muss die Gegenprobe anschlagen.
test('Gegenprobe erkennt fehlende Wärme auch wenn die Raumsumme über der Gebäudesumme liegt', () => {
  const ergebnis = berechneGebaeude(beispielF([{ raumId: 'b1', prozent: 59.5 }, { raumId: 'b2', prozent: 40 }]));
  const g = ergebnis.gebaeude.guenstig;
  wahr(g.heizlast > g.summe, 'Raumsumme liegt über der Gebäudesumme');
  gleich(g.differenz, 1.17, 0.01, 'Differenz');
  wahr(ergebnis.warnungen.some((w) => w.art === 'gegenprobe'), 'Warnung fehlt');
});

// Verteilung 110 %: 0,1 · 233,95 = 23,40 W zu viel, Differenz −23,40 W.
test('Gegenprobe erkennt doppelt gezählte Wärme', () => {
  const ergebnis = berechneGebaeude(beispielF([{ raumId: 'b1', prozent: 60 }, { raumId: 'b2', prozent: 50 }]));
  gleich(ergebnis.gebaeude.guenstig.differenz, -23.40, 0.01, 'Differenz');
  const w = ergebnis.warnungen.find((x) => x.art === 'gegenprobe' && x.fall === 'guenstig');
  wahr(w && w.differenz < -1, 'Warnung mit negativer Differenz erwartet');
});

test('Fläche zu unbekanntem oder unbeheiztem Raum erzeugt einen Hinweis', () => {
  const eingabe = beispielE();
  eingabe.raeume[0].flaechen[1].angrenzend = { art: 'raum', raumId: 'gibt-es-nicht' };
  const ergebnis = berechneGebaeude(eingabe);
  wahr(ergebnis.warnungen.some((w) => w.art === 'gegenraum_unbrauchbar' && w.grund === 'nachbar_unbekannt'), 'Hinweis fehlt');
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

// --- Hinweis: beheizter Raum grenzt an passiven Raum ohne Wärmeanteil ---------------
//
// In Beispiel D grenzt B1 über die Wand b1-p an den passiven Raum P (und P über p-b1 an B1).
// Erhält B1 keinen Anteil, ist seine Raumheizlast möglicherweise zu niedrig: Hinweis genau einmal.
// Verteilung 100 % auf B2: B2 grenzt nicht an P, B1 grenzt an P und hat 0 %.
test('Hinweis: beheizter Raum grenzt an passiven Raum, erhält aber 0 %', () => {
  const ergebnis = berechneGebaeude(beispielD({ verteilung: [{ raumId: 'b2', prozent: 100 }] }));
  const treffer = ergebnis.warnungen.filter((w) => w.art === 'passiv_ohne_anteil');
  wahr(treffer.length === 1, `genau ein Hinweis erwartet, gefunden: ${treffer.length}`);
  wahr(treffer[0].raumId === 'b1' && treffer[0].passivId === 'p', 'Hinweis gehört zu B1 und P');
});

test('Hinweis entfällt, wenn der angrenzende Raum einen Anteil erhält', () => {
  const ergebnis = berechneGebaeude(beispielD());
  wahr(!ergebnis.warnungen.some((w) => w.art === 'passiv_ohne_anteil'), 'bei 60 % / 40 % kein Hinweis');
});

test('Hinweis erkennt die Grenze auch, wenn nur der passive Raum die Fläche führt', () => {
  const eingabe = beispielD({ verteilung: [{ raumId: 'b2', prozent: 100 }] });
  eingabe.raeume.find((r) => r.id === 'b1').flaechen = eingabe.raeume.find((r) => r.id === 'b1').flaechen.filter((f) => f.id !== 'b1-p');
  const ergebnis = berechneGebaeude(eingabe);
  wahr(ergebnis.warnungen.some((w) => w.art === 'passiv_ohne_anteil' && w.raumId === 'b1'), 'Hinweis über die Fläche p-b1');
});
