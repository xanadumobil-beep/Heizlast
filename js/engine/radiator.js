// Heizkörperleistung bei Betriebsbedingungen.
// Formel: Φ = Φ_n · (ΔT_log / ΔT_log,n)^n
// ΔT_log = (t_V − t_R) / ln((t_V − t_i) / (t_R − t_i))
// Bedingungen sind jeweils { tV, tR, ti } in °C.

// Logarithmische Übertemperatur. Liefert 0, wenn die Bedingungen
// physikalisch keinen Sinn ergeben (Vorlauf oder Rücklauf nicht über Raumtemperatur).
export function dtLog({ tV, tR, ti }) {
  const a = tV - ti;
  const b = tR - ti;
  if (a <= 0 || b <= 0) return 0;
  if (Math.abs(a - b) < 1e-9) return a; // Spreizung 0: Grenzwert der Formel
  return (a - b) / Math.log(a / b);
}

// Leistung eines Heizkörpers bei gegebenen Betriebsbedingungen.
// heizkoerper: { phiN, n, norm: { tV, tR, ti } }
export function leistungBeiBedingung(heizkoerper, bedingung) {
  const verhaeltnis = dtLog(bedingung) / dtLog(heizkoerper.norm);
  if (verhaeltnis <= 0) return 0;
  return heizkoerper.phiN * Math.pow(verhaeltnis, heizkoerper.n);
}

// --- Heizkörper insgesamt: Exponentenmodell oder Kennlinie aus dem Datenblatt ---------------
//
// Heizkörper (Eingabe für den Rechenkern):
//   { id, status: 'bleibt' | 'entfaellt' | 'neu' | 'geplant', bauart,
//     phiN, n, norm: { tV, tR, ti },                       Normleistung in W mit Bedingungen, Exponent n
//     kennlinie: [{ vorlauf, leistung }], kennlinieRaumtemperatur }   Wärmepumpen-Heizkörper
// Fehlen die Leistungsangaben, gibt es keinen Ersatzwert: die Leistung gilt als fehlend.

export const AKTIVE_STATI = ['bleibt', 'neu', 'geplant'];

// Nur Heizkörper mit diesem Status tragen zur Deckung bei ("entfällt" zählt nicht).
export const zaehltMit = (heizkoerper) => AKTIVE_STATI.includes(heizkoerper.status);

const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);

function normGueltig(norm) {
  return Boolean(norm) && [norm.tV, norm.tR, norm.ti].every(istZahl) && norm.tV > norm.tR && norm.tR > norm.ti;
}

// Kennlinie als Wertepaare (Vorlauftemperatur, Leistung), nach Vorlauf sortiert.
// Ungültige Paare entfallen. Ein Wärmepumpen-Heizkörper braucht mindestens zwei Paare.
export function sortierteKennlinie(kennlinie) {
  return (kennlinie ?? [])
    .filter((p) => istZahl(p.vorlauf) && istZahl(p.leistung))
    .sort((a, b) => a.vorlauf - b.vorlauf);
}

// Lineare Interpolation zwischen den Wertepaaren. Außerhalb des Bereichs wird nicht extrapoliert.
// Rückgabe: { art: 'ok', leistung } | { art: 'fehlt' } | { art: 'ausserhalb', von, bis }
export function interpoliereKennlinie(kennlinie, tV) {
  const paare = sortierteKennlinie(kennlinie);
  if (paare.length < 2) return { art: 'fehlt' };
  const von = paare[0].vorlauf;
  const bis = paare[paare.length - 1].vorlauf;
  if (tV < von - 1e-9 || tV > bis + 1e-9) return { art: 'ausserhalb', von, bis };

  for (let i = 1; i < paare.length; i += 1) {
    const unten = paare[i - 1];
    const oben = paare[i];
    if (tV <= oben.vorlauf + 1e-9) {
      if (oben.vorlauf === unten.vorlauf) return { art: 'ok', leistung: oben.leistung };
      const anteil = (tV - unten.vorlauf) / (oben.vorlauf - unten.vorlauf);
      return { art: 'ok', leistung: unten.leistung + anteil * (oben.leistung - unten.leistung) };
    }
  }
  return { art: 'ok', leistung: paare[paare.length - 1].leistung };
}

// Leistung eines Heizkörpers bei Vorlauf tV, Rücklauf tR und Raumtemperatur ti.
// Wärmepumpen-Heizkörper ('wp') nutzen die Kennlinie und ignorieren Rücklauf und Raumtemperatur:
// die Datenblattwerte gelten für die dort angegebene Raumtemperatur.
// Rückgabe: { art: 'ok', leistung } | { art: 'fehlt' } | { art: 'ausserhalb', von, bis }
export function heizkoerperLeistung(heizkoerper, { tV, tR, ti }) {
  if (heizkoerper.bauart === 'wp') return interpoliereKennlinie(heizkoerper.kennlinie, tV);
  if (!(heizkoerper.phiN > 0) || !normGueltig(heizkoerper.norm) || !(heizkoerper.n > 0)) return { art: 'fehlt' };
  return { art: 'ok', leistung: leistungBeiBedingung(heizkoerper, { tV, tR, ti }) };
}
