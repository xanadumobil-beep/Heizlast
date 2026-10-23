// Verbrauchsabgleich: spezifischer Wärmeverlust H und Heizlast bei Normaußentemperatur aus dem Verbrauch.
// Reine Funktionen ohne Oberflächenbezug.
//
// Rechenweg:
//   Nutzwärme    Q = (Gas − Warmwasser) · η_Kessel + Holz[Rm] · Heizwert[kWh/Rm] · η_Ofen
//   Gradtagzahl  G = Σ über die gewählten Heizmonate von ( G20/15 − (20 − θ_i) · Heiztage )
//   Wärmeverlust H = Q · 1000 / (24 · G)                      in W/K
//   Heizlast     Φ_N = H · (θ_i − θ_N)                        in W
// Die Bandbreite entsteht aus den Min/Max-Werten von Kesselnutzungsgrad, Heizwert und Ofenwirkungsgrad:
// unten alle Minimalwerte, oben alle Maximalwerte. Gasmenge, Warmwasser, Gradtage und Innentemperatur sind fest.

import { formatZahl, formatBereich, zahlZuText } from './format.js';

export const FREMDWAERME_HINWEIS =
  'Fremdwärme (Sonne, Personen, Geräte) ist im Verbrauch bereits abgezogen. '
  + 'Die aus dem Verbrauch abgeleitete Heizlast liegt deshalb eher zu niedrig.';

export const HS_HINWEIS = 'bezogen auf Brennwert Hs, wie in der Gasrechnung';

const BEZUGS_INNENTEMPERATUR = 20; // G20/15 gilt für 20 °C Innentemperatur
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);

// Gradtagzahl der gewählten Heizmonate, umgerechnet auf die mittlere Innentemperatur.
// Ein gewählter Monat ohne Gradtagzahl oder Heiztage macht das Ergebnis ungültig (unvollstaendig > 0).
export function gradtage(monate, innentemperatur) {
  const gewaehlt = monate.filter((m) => m.heizmonat);
  const vollstaendig = gewaehlt.filter((m) => istZahl(m.gradtage) && istZahl(m.heiztage));
  const g20_15 = vollstaendig.reduce((s, m) => s + m.gradtage, 0);
  const heiztage = vollstaendig.reduce((s, m) => s + m.heiztage, 0);
  const korrektur = (BEZUGS_INNENTEMPERATUR - innentemperatur) * heiztage;
  return {
    monate: vollstaendig.length,
    unvollstaendig: gewaehlt.length - vollstaendig.length,
    g20_15,
    heiztage,
    korrektur,
    g: g20_15 - korrektur,
  };
}

// Eingabe:
//   gasKwh, warmwasserKwh, kesselNutzungsgrad { min, max } in %,
//   holzRm, heizwertRm { min, max } in kWh/Rm, ofenWirkungsgrad { min, max } in %,
//   monate [{ name, gradtage, heiztage, heizmonat }], innentemperatur, normAussentemperatur
// Ergebnis: { status: 'ok', gradtage, heizgasKwh, gasNutz, holzNutz, waerme, h, heizlast }
//        oder { status: 'fehler', grund }.
export function berechneVerbrauch(e) {
  const holzRm = istZahl(e.holzRm) ? e.holzRm : 0;
  const warmwasser = istZahl(e.warmwasserKwh) ? e.warmwasserKwh : 0;
  if (![e.gasKwh, e.innentemperatur, e.normAussentemperatur].every(istZahl)) return { status: 'fehler', grund: 'angaben_fehlen' };
  const kessel = e.kesselNutzungsgrad;
  if (!kessel || !istZahl(kessel.min) || !istZahl(kessel.max)) return { status: 'fehler', grund: 'angaben_fehlen' };
  if (holzRm > 0) {
    const brauchtBereiche = [e.heizwertRm, e.ofenWirkungsgrad];
    if (brauchtBereiche.some((b) => !b || !istZahl(b.min) || !istZahl(b.max))) return { status: 'fehler', grund: 'holz_angaben_fehlen' };
  }
  const heizgasKwh = e.gasKwh - warmwasser;
  if (heizgasKwh < 0) return { status: 'fehler', grund: 'warmwasser_zu_gross' };

  const g = gradtage(e.monate ?? [], e.innentemperatur);
  if (g.unvollstaendig > 0) return { status: 'fehler', grund: 'monat_unvollstaendig' };
  if (g.monate === 0) return { status: 'fehler', grund: 'keine_heizmonate' };
  if (!(g.g > 0)) return { status: 'fehler', grund: 'gradtage_nicht_positiv', gradtage: g };

  const deltaT = e.innentemperatur - e.normAussentemperatur;
  const faelle = {};
  for (const kante of ['min', 'max']) {
    const gasNutz = (heizgasKwh * kessel[kante]) / 100;
    const holzNutz = holzRm > 0 ? (holzRm * e.heizwertRm[kante] * e.ofenWirkungsgrad[kante]) / 100 : 0;
    const waerme = gasNutz + holzNutz;
    const h = (waerme * 1000) / (24 * g.g);
    faelle[kante] = { gasNutz, holzNutz, waerme, h, heizlast: h * deltaT };
  }
  const bereich = (feld) => ({
    min: faelle.min[feld], max: faelle.max[feld], mittel: (faelle.min[feld] + faelle.max[feld]) / 2,
  });
  return {
    status: 'ok',
    gradtage: g,
    heizgasKwh,
    holzRm,
    deltaT,
    gasNutz: bereich('gasNutz'),
    holzNutz: bereich('holzNutz'),
    waerme: bereich('waerme'),
    h: bereich('h'),
    heizlast: bereich('heizlast'),
  };
}

// Vergleich der aus dem Verbrauch abgeleiteten Heizlast mit der berechneten Gebäudeheizlast.
// Beide als Bandbreite { min, max }. Abweichung in Prozent bezieht sich auf die Mittelwerte und ist
// positiv, wenn der Verbrauch eine höhere Heizlast ergibt als die Berechnung.
export function vergleiche(berechnet, verbrauch) {
  if (!berechnet || !verbrauch) return null;
  const mittelBerechnet = (berechnet.min + berechnet.max) / 2;
  const mittelVerbrauch = (verbrauch.min + verbrauch.max) / 2;
  return {
    mittelBerechnet,
    mittelVerbrauch,
    abweichungProzent: mittelBerechnet > 0 ? ((mittelVerbrauch - mittelBerechnet) / mittelBerechnet) * 100 : null,
    ueberlappung: Math.max(berechnet.min, verbrauch.min) <= Math.min(berechnet.max, verbrauch.max),
  };
}

const prozent = (b) => `${formatBereich(b.min, b.max, 1)} %`;

// Alle Annahmen und Zwischenschritte als Text, damit nichts im Ergebnis verborgen bleibt.
export function annahmen(e, r) {
  const monate = e.monate.filter((m) => m.heizmonat);
  const g = r.gradtage;
  const hatHolz = r.holzRm > 0;
  const zeilen = [
    `Berücksichtigte Heizmonate (${g.monate}): ${monate.map((m) => m.name || 'ohne Namen').join(', ')}. `
      + `Summe G20/15 = ${formatZahl(g.g20_15, 0)} Kd, Heiztage = ${formatZahl(g.heiztage, 0)}. Nicht gewählte Monate zählen nicht.`,
    `Umrechnung auf die mittlere Innentemperatur θ_i = ${zahlZuText(e.innentemperatur)} °C: `
      + `G = G20/15 − (20 − θ_i) · Heiztage = ${formatZahl(g.g20_15, 0)} − ${zahlZuText(20 - e.innentemperatur)} · ${formatZahl(g.heiztage, 0)} `
      + `= ${formatZahl(g.g, 0)} Kd.`,
    `Gas: ${formatZahl(e.gasKwh, 0)} kWh (${HS_HINWEIS}), davon Warmwasser ${formatZahl(e.warmwasserKwh ?? 0, 0)} kWh abgezogen, `
      + `bleiben ${formatZahl(r.heizgasKwh, 0)} kWh für die Heizung.`,
    `Kesselnutzungsgrad ${prozent(e.kesselNutzungsgrad)} (${HS_HINWEIS}).`,
    hatHolz
      ? `Holz: ${zahlZuText(r.holzRm)} Rm × Heizwert ${formatBereich(e.heizwertRm.min, e.heizwertRm.max, 0)} kWh/Rm `
        + `× Wirkungsgrad Kaminofen ${prozent(e.ofenWirkungsgrad)}.`
      : 'Kein Holz berücksichtigt.',
    `Nutzwärme Q = Gas · η_Kessel + Holz = ${formatBereich(r.waerme.min, r.waerme.max, 0)} kWh `
      + `(Gas ${formatBereich(r.gasNutz.min, r.gasNutz.max, 0)} kWh, Holz ${formatBereich(r.holzNutz.min, r.holzNutz.max, 0)} kWh).`,
    `Spezifischer Wärmeverlust H = Q · 1000 / (24 · G) = ${formatBereich(r.h.min, r.h.max, 1)} W/K.`,
    `Heizlast bei Normaußentemperatur θ_N = ${zahlZuText(e.normAussentemperatur)} °C (aus den Einstellungen) und mittlerer Innentemperatur `
      + `${zahlZuText(e.innentemperatur)} °C: Φ_N = H · (θ_i − θ_N) = H · ${zahlZuText(r.deltaT)} K = ${formatBereich(r.heizlast.min, r.heizlast.max, 0)} W.`,
    'Bandbreite: Der untere Wert nutzt alle Minimalwerte (Kesselnutzungsgrad, Heizwert, Wirkungsgrad), der obere alle Maximalwerte. '
      + 'Gasmenge, Warmwasser, Gradtage und Innentemperatur sind feste Werte.',
    FREMDWAERME_HINWEIS,
  ];
  return zeilen;
}
