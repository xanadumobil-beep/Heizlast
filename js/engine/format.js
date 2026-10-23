// Zahlen für Eingabe und Anzeige im deutschen Format.
// Eingabe: "1,5" oder "1.5" werden beide als 1.5 gelesen.
// Anzeige: 1.5 wird als "1,5" ausgegeben.

// Gibt null für leere Eingabe zurück und NaN für ungültige Eingabe.
export function parseDezimal(text) {
  if (typeof text === 'number') return text;
  const bereinigt = String(text ?? '').trim().replace(',', '.');
  if (bereinigt === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(bereinigt)) return NaN;
  return Number(bereinigt);
}

// Zahl als Text für ein Eingabefeld: 0.15 wird zu "0,15", ohne feste Nachkommastellen.
export function zahlZuText(wert) {
  if (wert === null || wert === undefined || Number.isNaN(wert)) return '';
  return String(wert).replace('.', ',');
}

// Von–bis-Anzeige. Runden beide Enden gleich, erscheint nur ein Wert.
export function formatBereich(von, bis, nachkommastellen = 0) {
  const a = formatZahl(Math.min(von, bis), nachkommastellen);
  const b = formatZahl(Math.max(von, bis), nachkommastellen);
  return a === b ? a : `${a} – ${b}`;
}

export function formatZahl(wert, nachkommastellen = 1) {
  if (wert === null || wert === undefined || Number.isNaN(wert)) return '–';
  const text = wert.toFixed(nachkommastellen);
  // Ein auf null gerundeter negativer Wert zeigt kein Minuszeichen ("-0" wäre irreführend).
  return (Number(text) === 0 ? text.replace('-', '') : text).replace('.', ',');
}
