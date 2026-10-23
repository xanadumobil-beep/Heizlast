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

export function formatZahl(wert, nachkommastellen = 1) {
  if (wert === null || wert === undefined || Number.isNaN(wert)) return '–';
  return wert.toFixed(nachkommastellen).replace('.', ',');
}
