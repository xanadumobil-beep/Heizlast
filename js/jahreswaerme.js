// Jahreswärme-Differenz eines Szenarios gegenüber dem Ist-Zustand. Reine Funktionen ohne Oberfläche.
//
// Aus der Änderung der Gebäudeheizlast wird eine grobe Änderung der Jahreswärme abgeschätzt:
//   ΔH = ΔΦ / (θ_soll,Mittel − θ_e)       in W/K   (Änderung des Wärmeverlusts je Kelvin)
//   ΔQ = ΔH · 24 · G / 1000               in kWh/a (G: Gradtagzahl in Kd, umgerechnet auf θ_soll,Mittel)
//   ΔStrom = ΔQ / JAZ                     in kWh/a (optional, Jahresarbeitszahl der Wärmepumpe)
//   Stromkosten = ΔStrom · Preis / 100    in €/a   (optional, Strompreis in ct/kWh)
// Δ ist immer „Ist-Zustand minus Szenario“: positiv heißt weniger Bedarf, negativ heißt Mehrbedarf.
// Jede Größe ist eine Bandbreite { min, max }, die Unsicherheit von ΔΦ, JAZ und Strompreis wird durchgereicht.

import { gradtage } from './engine/verbrauch.js';

export const JAHRESHINWEIS = 'Schätzung aus der Heizlast, Fremdwärme und Nutzerverhalten nicht berücksichtigt.';

const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const bereichOk = (b) => Boolean(b) && istZahl(b.min) && istZahl(b.max);

// Annahmen aus den Einstellungen (einstellungen.vergleich), mit Vorgaben für fehlende Teile.
export function vergleichsannahmen(einstellungen) {
  const v = einstellungen?.vergleich ?? {};
  const bereich = (b) => (b && typeof b === 'object' ? { min: istZahl(b.min) ? b.min : null, max: istZahl(b.max) ? b.max : null } : { min: null, max: null });
  return {
    gradtage: {
      quelle: v.gradtage?.quelle === 'manuell' ? 'manuell' : 'verbrauch',
      verbrauchId: typeof v.gradtage?.verbrauchId === 'string' ? v.gradtage.verbrauchId : null,
      manuell: istZahl(v.gradtage?.manuell) ? v.gradtage.manuell : null,
    },
    jaz: bereich(v.jaz),
    strompreis: bereich(v.strompreis),
  };
}

// Gradtagzahl G in Kd: aus einem Verbrauchsdatensatz (Summe der Heizmonate, umgerechnet auf θ_soll,Mittel) oder manuell.
// Rückgabe: { g, text } mit g = null und einem Grund in text, wenn G fehlt.
export function loeseGradtageAuf(verbrauch, annahmen, thetaMittel) {
  if (annahmen.gradtage.quelle === 'manuell') {
    return annahmen.gradtage.manuell > 0
      ? { g: annahmen.gradtage.manuell, text: `${annahmen.gradtage.manuell} Kd (manuell eingegeben)` }
      : { g: null, text: 'Gradtagzahl G fehlt (manuell eingeben)' };
  }
  const doc = verbrauch.find((v) => v.id === annahmen.gradtage.verbrauchId);
  if (!doc) return { g: null, text: 'Gradtagzahl G fehlt (Verbrauchsdatensatz wählen oder G eingeben)' };
  if (!istZahl(thetaMittel)) return { g: null, text: 'Gradtagzahl G fehlt (keine mittlere Soll-Temperatur aus den Räumen)' };
  const r = gradtage(doc.monate ?? [], thetaMittel);
  if (r.monate === 0 || !(r.g > 0)) return { g: null, text: `Gradtagzahl G fehlt (Verbrauchsdatensatz „${doc.name}“ hat keine gültigen Heizmonate)` };
  return { g: r.g, text: `${Math.round(r.g)} Kd aus „${doc.name}“ (Heizmonate, umgerechnet auf ${String(Math.round(thetaMittel * 10) / 10).replace('.', ',')} °C)` };
}

// Alle Kombinationen zweier Bandbreiten, Ergebnis ist die kleinste und größte (richtig auch bei negativen Werten).
function kombiniere(a, b, f) {
  const werte = [f(a.min, b.min), f(a.min, b.max), f(a.max, b.min), f(a.max, b.max)];
  return { min: Math.min(...werte), max: Math.max(...werte) };
}

// deltaPhi { min, max } in W, thetaMittel und thetaAussen in °C, gradtage in Kd (oder null),
// jaz { min, max } und strompreis { min, max } in ct/kWh (oder mit null-Werten, wenn nicht eingegeben).
// Rückgabe: { deltaH, deltaQ, deltaStrom, kosten } (jeweils Bandbreite oder null) und grund (Text, wenn ΔH nicht berechenbar ist).
export function berechneJahreswaerme({ deltaPhi, thetaMittel, thetaAussen, gradtage: g, jaz, strompreis }) {
  const leer = { deltaH: null, deltaQ: null, deltaStrom: null, kosten: null };
  if (!bereichOk(deltaPhi)) return { ...leer, grund: 'Heizlast nicht berechenbar' };
  const dT = thetaMittel - thetaAussen;
  if (!istZahl(dT) || !(dT > 0)) return { ...leer, grund: 'mittlere Soll-Temperatur nicht über der Normaußentemperatur' };
  const deltaH = { min: deltaPhi.min / dT, max: deltaPhi.max / dT };
  if (!(g > 0)) return { ...leer, deltaH, grund: 'Gradtagzahl G fehlt' };
  const deltaQ = { min: (deltaH.min * 24 * g) / 1000, max: (deltaH.max * 24 * g) / 1000 };
  const deltaStrom = bereichOk(jaz) && jaz.min > 0 ? kombiniere(deltaQ, jaz, (q, j) => q / j) : null;
  const kosten = deltaStrom && bereichOk(strompreis) ? kombiniere(deltaStrom, strompreis, (s, p) => (s * p) / 100) : null;
  return { deltaH, deltaQ, deltaStrom, kosten, grund: null };
}
