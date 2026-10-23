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
