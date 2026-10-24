// Verbrauchsabgleich: spezifischer Wärmeverlust H und Heizlast bei Normaußentemperatur aus dem Verbrauch.
// Reine Funktionen ohne Oberflächenbezug.
//
// Rechenweg:
//   Nutzwärme    Q = (Gas − nicht für Heizung) · η_Kessel + Holz[Rm] · Heizwert[kWh/Rm] · η_Ofen
//   Gradtagzahl  G = Σ über die gewählten Heizmonate von ( G20/15 − (20 − θ_ist) · Heiztage )
//   Wärmeverlust H = Q · 1000 / (24 · G)                      in W/K
//   Heizlast     Φ_N = H · (θ_soll − θ_N)                     in W
//
// Zwei Innentemperaturen mit verschiedenen Aufgaben:
//   θ_ist   tatsächliche mittlere Innentemperatur im Verbrauchszeitraum (Min/Max, geschätzt). Nur sie geht
//           in die Gradtag-Umrechnung und damit in H ein. Unterheizte Räume senken sie.
//   θ_soll  mittlere Soll-Innentemperatur für die Auslegung. Nur sie geht in Φ_N = H · (θ_soll − θ_N) ein.
//
// Die Bandbreite entsteht aus den Min/Max-Werten von Kesselnutzungsgrad, Heizwert, Ofenwirkungsgrad und θ_ist:
//   unten alle Minimalwerte und θ_ist-Maximum, oben alle Maximalwerte und θ_ist-Minimum.
//   Eine niedrigere tatsächliche Temperatur ergibt eine kleinere Gradtagzahl und damit ein höheres H.
// Gasmenge, Nicht-Heizungs-Anteil, Gradtage und θ_soll sind feste Werte.

import { formatZahl, formatBereich, zahlZuText } from './format.js';

export const FREMDWAERME_HINWEIS =
  'Fremdwärme (Sonne, Personen, Geräte) ist im Verbrauch bereits abgezogen. '
  + 'Die aus dem Verbrauch abgeleitete Heizlast liegt deshalb eher zu niedrig.';

export const HS_HINWEIS = 'bezogen auf Brennwert Hs, wie in der Gasrechnung';

export const IST_HINWEIS = 'Wie warm war es wirklich? Unterheizte Räume senken diesen Wert.';

const BEZUGS_INNENTEMPERATUR = 20; // G20/15 gilt für 20 °C Innentemperatur
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);

// Gradtagzahl der gewählten Heizmonate, umgerechnet auf eine Innentemperatur.
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

const bereichGueltig = (b) => Boolean(b) && istZahl(b.min) && istZahl(b.max);

// Eingabe:
//   gasKwh, nichtFuerHeizungKwh (Warmwasser, Gasherd, Sonstiges), kesselNutzungsgrad { min, max } in %,
//   holzRm, heizwertRm { min, max } in kWh/Rm, ofenWirkungsgrad { min, max } in %,
//   monate [{ name, gradtage, heiztage, heizmonat }],
//   innentemperaturIst { min, max }, innentemperaturSoll, normAussentemperatur
// Ergebnis: { status: 'ok', gradtage, heizgasKwh, gasNutz, holzNutz, waerme, h, heizlast }
//        oder { status: 'fehler', grund }.
// gradtage.unten gehört zum unteren Wert der Bandbreite (θ_ist-Maximum), gradtage.oben zum oberen (θ_ist-Minimum).
export function berechneVerbrauch(e) {
  const holzRm = istZahl(e.holzRm) ? e.holzRm : 0;
  const nichtHeizung = istZahl(e.nichtFuerHeizungKwh) ? e.nichtFuerHeizungKwh : 0;
  if (![e.gasKwh, e.innentemperaturSoll, e.normAussentemperatur].every(istZahl)) return { status: 'fehler', grund: 'angaben_fehlen' };
  if (!bereichGueltig(e.kesselNutzungsgrad) || !bereichGueltig(e.innentemperaturIst)) return { status: 'fehler', grund: 'angaben_fehlen' };
  if (holzRm > 0 && !(bereichGueltig(e.heizwertRm) && bereichGueltig(e.ofenWirkungsgrad))) {
    return { status: 'fehler', grund: 'holz_angaben_fehlen' };
  }
  const heizgasKwh = e.gasKwh - nichtHeizung;
  if (heizgasKwh < 0) return { status: 'fehler', grund: 'nicht_heizung_zu_gross' };

  const monate = e.monate ?? [];
  const unten = gradtage(monate, e.innentemperaturIst.max);
  const oben = gradtage(monate, e.innentemperaturIst.min);
  if (unten.unvollstaendig > 0) return { status: 'fehler', grund: 'monat_unvollstaendig' };
  if (unten.monate === 0) return { status: 'fehler', grund: 'keine_heizmonate' };
  if (!(unten.g > 0) || !(oben.g > 0)) return { status: 'fehler', grund: 'gradtage_nicht_positiv', gradtage: { unten, oben } };

  const deltaT = e.innentemperaturSoll - e.normAussentemperatur;
  const gradtageJeKante = { min: unten.g, max: oben.g };
  const faelle = {};
  for (const kante of ['min', 'max']) {
    const gasNutz = (heizgasKwh * e.kesselNutzungsgrad[kante]) / 100;
    const holzNutz = holzRm > 0 ? (holzRm * e.heizwertRm[kante] * e.ofenWirkungsgrad[kante]) / 100 : 0;
    const waerme = gasNutz + holzNutz;
    const h = (waerme * 1000) / (24 * gradtageJeKante[kante]);
    faelle[kante] = { gasNutz, holzNutz, waerme, h, heizlast: h * deltaT };
  }
  const bereich = (feld) => ({
    min: faelle.min[feld], max: faelle.max[feld], mittel: (faelle.min[feld] + faelle.max[feld]) / 2,
  });
  return {
    status: 'ok',
    gradtage: { monate: unten.monate, g20_15: unten.g20_15, heiztage: unten.heiztage, unten, oben },
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
  const ist = e.innentemperaturIst;
  const hatHolz = r.holzRm > 0;
  const gleich = ist.min === ist.max;
  const gradtagRechnung = (fall) => (
    `G = ${formatZahl(g.g20_15, 0)} − ${zahlZuText(20 - fall.innentemperatur)} · ${formatZahl(g.heiztage, 0)} = ${formatZahl(fall.g, 0)} Kd`
  );
  const zeilen = [
    `Berücksichtigte Heizmonate (${g.monate}): ${monate.map((m) => m.name || 'ohne Namen').join(', ')}. `
      + `Summe G20/15 = ${formatZahl(g.g20_15, 0)} Kd, Heiztage = ${formatZahl(g.heiztage, 0)}. Nicht gewählte Monate zählen nicht.`,
    `Tatsächliche mittlere Innentemperatur im Verbrauchszeitraum θ_ist = ${gleich ? zahlZuText(ist.min) : `${zahlZuText(ist.min)} bis ${zahlZuText(ist.max)}`} °C `
      + '(geschätzt, nur sie geht in die Gradtag-Umrechnung und damit in H ein). Umrechnung: G = G20/15 − (20 − θ_ist) · Heiztage. '
      + (gleich
        ? `${gradtagRechnung({ ...g.unten, innentemperatur: ist.min })}.`
        : `Unterer Wert (θ_ist-Maximum ${zahlZuText(ist.max)} °C): ${gradtagRechnung({ ...g.unten, innentemperatur: ist.max })}. `
          + `Oberer Wert (θ_ist-Minimum ${zahlZuText(ist.min)} °C): ${gradtagRechnung({ ...g.oben, innentemperatur: ist.min })}. `
          + 'Eine niedrigere tatsächliche Temperatur ergibt eine kleinere Gradtagzahl und damit ein höheres H.'),
    `Gas: ${formatZahl(e.gasKwh, 0)} kWh (${HS_HINWEIS}), davon nicht für Heizung (Warmwasser, Gasherd, Sonstiges) `
      + `${formatZahl(e.nichtFuerHeizungKwh ?? 0, 0)} kWh abgezogen, bleiben ${formatZahl(r.heizgasKwh, 0)} kWh für die Heizung.`,
    `Kesselnutzungsgrad ${prozent(e.kesselNutzungsgrad)} (${HS_HINWEIS}).`,
    hatHolz
      ? `Holz: ${zahlZuText(r.holzRm)} Rm × Heizwert ${formatBereich(e.heizwertRm.min, e.heizwertRm.max, 0)} kWh/Rm `
        + `× Wirkungsgrad Kaminofen ${prozent(e.ofenWirkungsgrad)}.`
      : 'Kein Holz berücksichtigt.',
    `Nutzwärme Q = Gas · η_Kessel + Holz = ${formatBereich(r.waerme.min, r.waerme.max, 0)} kWh `
      + `(Gas ${formatBereich(r.gasNutz.min, r.gasNutz.max, 0)} kWh, Holz ${formatBereich(r.holzNutz.min, r.holzNutz.max, 0)} kWh).`,
    `Spezifischer Wärmeverlust H = Q · 1000 / (24 · G) = ${formatBereich(r.h.min, r.h.max, 1)} W/K.`,
    `Heizlast bei Normaußentemperatur θ_N = ${zahlZuText(e.normAussentemperatur)} °C (aus den Einstellungen) und mittlerer Soll-Innentemperatur `
      + `θ_soll = ${zahlZuText(e.innentemperaturSoll)} °C (nur sie geht in die Hochrechnung ein): Φ_N = H · (θ_soll − θ_N) = H · ${zahlZuText(r.deltaT)} K `
      + `= ${formatBereich(r.heizlast.min, r.heizlast.max, 0)} W.`,
    'Bandbreite: Der untere Wert nutzt alle Minimalwerte (Kesselnutzungsgrad, Heizwert, Wirkungsgrad) und das Maximum der tatsächlichen '
      + 'Innentemperatur, der obere alle Maximalwerte und das Minimum der tatsächlichen Innentemperatur. '
      + 'Gasmenge, Nicht-Heizungs-Anteil, Gradtage und Soll-Innentemperatur sind feste Werte.',
    FREMDWAERME_HINWEIS,
  ];
  return zeilen;
}
