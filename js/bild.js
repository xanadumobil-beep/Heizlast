// Bilder verarbeiten (Browser): laden, auf eine Höchstgröße verkleinern, als JPEG speichern, Vorschau erzeugen.
// HEIC-Fotos vom iPhone liest der Browser selbst (Safari kann HEIC dekodieren). Geht ein Format nicht, gibt es eine klare Meldung.

import { zielGroesse, FOTO_MAX_SEITE, FOTO_QUALITAET, VORSCHAU_MAX_SEITE } from './foto.js';

export class BildFehler extends Error {
  constructor(text) {
    super(text);
    this.name = 'BildFehler';
  }
}

// Datei in ein Bildobjekt laden. Rückgabe: { quelle, breite, hoehe, freigeben }.
async function ladeQuelle(datei) {
  const adresse = URL.createObjectURL(datei);
  try {
    const bild = new Image();
    bild.decoding = 'async';
    bild.src = adresse;
    await bild.decode();
    if (!(bild.naturalWidth > 0)) throw new Error('leer');
    return { quelle: bild, breite: bild.naturalWidth, hoehe: bild.naturalHeight, freigeben: () => URL.revokeObjectURL(adresse) };
  } catch {
    URL.revokeObjectURL(adresse);
  }
  // Zweiter Weg: createImageBitmap (bei manchen Formaten und Browsern erfolgreich, wenn das Bildelement scheitert).
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(datei);
      return { quelle: bitmap, breite: bitmap.width, hoehe: bitmap.height, freigeben: () => bitmap.close?.() };
    } catch {
      // weiter mit der Fehlermeldung
    }
  }
  const art = `${datei.type || 'unbekanntes Format'}${datei.name ? ` (${datei.name})` : ''}`;
  throw new BildFehler(`Das Bild ${art} lässt sich in diesem Browser nicht lesen. Bei HEIC-Fotos hilft es, das Foto in der Fotos-App als JPEG zu teilen oder in den Einstellungen unter Kamera → Formate „Maximale Kompatibilität“ zu wählen.`);
}

function zeichne(quelle, breite, hoehe, ziel, drehung = 0) {
  const leinwand = document.createElement('canvas');
  const quer = drehung === 90 || drehung === 270;
  leinwand.width = quer ? ziel.hoehe : ziel.breite;
  leinwand.height = quer ? ziel.breite : ziel.hoehe;
  const g = leinwand.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, leinwand.width, leinwand.height);
  g.translate(leinwand.width / 2, leinwand.height / 2);
  g.rotate((drehung * Math.PI) / 180);
  g.drawImage(quelle, -ziel.breite / 2, -ziel.hoehe / 2, ziel.breite, ziel.hoehe);
  return leinwand;
}

const alsBlob = (leinwand, qualitaet) => new Promise((erfolg, fehler) => {
  leinwand.toBlob((b) => (b ? erfolg(b) : fehler(new BildFehler('Das Bild konnte nicht als JPEG gespeichert werden.'))), 'image/jpeg', qualitaet);
});

// Verkleinertes JPEG und kleine Vorschau. Rückgabe: { blob, breite, hoehe, vorschau }.
export async function verkleinereBild(datei, { maxSeite = FOTO_MAX_SEITE, qualitaet = FOTO_QUALITAET, vorschauSeite = VORSCHAU_MAX_SEITE } = {}) {
  const q = await ladeQuelle(datei);
  try {
    const ziel = zielGroesse(q.breite, q.hoehe, maxSeite);
    const gross = zeichne(q.quelle, q.breite, q.hoehe, ziel);
    const blob = await alsBlob(gross, qualitaet);
    const klein = zielGroesse(ziel.breite, ziel.hoehe, vorschauSeite);
    const vorschau = await alsBlob(zeichne(gross, ziel.breite, ziel.hoehe, klein), 0.7);
    return { blob, breite: ziel.breite, hoehe: ziel.hoehe, vorschau };
  } finally {
    q.freigeben();
  }
}

// Bauplan aus einem Bild oder einer PDF-Seite. Safari kann ein PDF wie ein Bild zeichnen (erste Seite). Andere Browser
// brauchen dafür ein Bild: dann erscheint eine Meldung mit Ausweg.
export async function ladeBauplan(datei, optionen) {
  const istPdf = datei.type === 'application/pdf' || /\.pdf$/i.test(datei.name ?? '');
  if (!istPdf) return verkleinereBild(datei, optionen);
  try {
    return await verkleinereBild(datei, optionen);
  } catch {
    throw new BildFehler('Dieses PDF lässt sich in diesem Browser nicht als Bild lesen. Speichere die Plan-Seite als Bild (Dateien-App → Schnellaktionen → Bild konvertieren, oder ein Foto bzw. einen Screenshot der Seite) und wähle dieses Bild.');
  }
}

// Vorschau-URL für ein Blob mit Aufräumen: Rückgabe { adresse, freigeben }.
export function blobAdresse(blob) {
  const adresse = URL.createObjectURL(blob);
  return { adresse, freigeben: () => URL.revokeObjectURL(adresse) };
}
