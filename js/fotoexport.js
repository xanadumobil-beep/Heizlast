// Fotos und Baupläne in der Sicherungsdatei: Blobs werden als data-URL (Base64) geschrieben und beim Import zurückverwandelt.
// Läuft im Browser und in Node (Blob, atob, btoa).

import { baueExport, exportText, PLATZHALTER_FOTOS, PLATZHALTER_HINTERGRUENDE } from './io.js';

const BLOCK = 0x8000;

// Blob → Base64 (in Blöcken, damit große Bilder den Aufrufstapel nicht sprengen).
export async function blobZuBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += BLOCK) text += String.fromCharCode(...bytes.subarray(i, i + BLOCK));
  return btoa(text);
}

export async function blobZuDataUrl(blob) {
  return `data:${blob.type || 'image/jpeg'};base64,${await blobZuBase64(blob)}`;
}

// data-URL → Blob. Ungültige Werte ergeben null.
export function dataUrlZuBlob(url) {
  const treffer = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url ?? '');
  if (!treffer) return null;
  const mime = treffer[1] || 'image/jpeg';
  try {
    const roh = treffer[2] ? atob(treffer[3]) : decodeURIComponent(treffer[3]);
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

const FOTO_FELDER = ['id', 'raumId', 'titel', 'notiz', 'datum', 'breite', 'hoehe'];
const BAUPLAN_FELDER = ['id', 'geschoss', 'drehung', 'deckkraft', 'sichtbar', 'breite', 'hoehe', 'quelle'];
const nur = (objekt, felder) => Object.fromEntries(felder.filter((f) => objekt[f] !== undefined).map((f) => [f, objekt[f]]));

// Ungefähre Größe der Datei in Byte: ohne Fotos und mit Fotos (Base64 ist rund ein Drittel größer als die Blobs).
export function schaetzeExportGroesse(speicher, jetzt = new Date()) {
  const ohne = new Blob([exportText(baueExport(speicher, jetzt))]).size;
  const blobs = [...(speicher.photos ?? []), ...(speicher.backgrounds ?? [])];
  const bildBytes = blobs.reduce((s, x) => s + (x.blob?.size ?? 0) + (x.vorschau?.size ?? 0), 0);
  const markierungen = new Blob([JSON.stringify(speicher.markers ?? [])]).size;
  return {
    fotos: (speicher.photos ?? []).length,
    hintergruende: (speicher.backgrounds ?? []).length,
    bildBytes,
    ohne,
    mit: ohne + markierungen + Math.ceil(bildBytes * 4 / 3) + blobs.length * 400,
  };
}

// Baut die Sicherungsdatei als Blob. mitFotos: Fotos, Markierungen und Baupläne mit Bilddaten. Die Bilder werden einzeln
// umgewandelt und als Teile des Blobs abgelegt, damit nicht die ganze Datei als ein riesiger Text im Speicher liegt.
// fortschritt(erledigt, gesamt) wird nach jedem Bild gerufen.
export async function baueExportBlob(speicher, jetzt = new Date(), { mitFotos = false, fortschritt = () => {} } = {}) {
  if (!mitFotos) return new Blob([exportText(baueExport(speicher, jetzt))], { type: 'application/json' });

  const text = exportText(baueExport(speicher, jetzt, { fotos: 'platzhalter' }));
  const muster = (platzhalter) => new RegExp(`\\[\\s*"${platzhalter}"\\s*\\]`);
  const teile = [];
  const gesamt = (speicher.photos ?? []).length + (speicher.backgrounds ?? []).length;
  let erledigt = 0;

  const eintraege = async (liste, felder) => {
    const stuecke = [];
    for (const x of liste) {
      stuecke.push(JSON.stringify({ ...nur(x, felder), bild: await blobZuDataUrl(x.blob), ...(x.vorschau ? { vorschau: await blobZuDataUrl(x.vorschau) } : {}) }));
      erledigt += 1;
      fortschritt(erledigt, gesamt);
    }
    return stuecke;
  };

  const fotoStuecke = await eintraege(speicher.photos ?? [], FOTO_FELDER);
  const bgStuecke = await eintraege(speicher.backgrounds ?? [], BAUPLAN_FELDER);

  let rest = text;
  for (const [platzhalter, stuecke] of [[PLATZHALTER_FOTOS, fotoStuecke], [PLATZHALTER_HINTERGRUENDE, bgStuecke]]) {
    const m = muster(platzhalter).exec(rest);
    teile.push(rest.slice(0, m.index), stuecke.length === 0 ? '[]' : `[\n${stuecke.join(',\n')}\n]`);
    rest = rest.slice(m.index + m[0].length);
  }
  teile.push(rest);
  return new Blob(teile, { type: 'application/json' });
}

// Nach pruefeImport: Bilddaten (data-URL) der Fotos und Baupläne in Blobs umwandeln, im Format des Speichers.
// Einträge mit unlesbaren Bilddaten werden ausgelassen. Rückgabe: Kopie von speicher und die Zahl der ausgelassenen Einträge.
export function dateiFotosZuBlobs(speicher) {
  let ausgelassen = 0;
  const wandle = (liste, felder, extra) => liste.flatMap((x) => {
    const blob = dataUrlZuBlob(x.bild);
    if (!blob) { ausgelassen += 1; return []; }
    const vorschau = x.vorschau ? dataUrlZuBlob(x.vorschau) : null;
    return [{ ...nur(x, felder), ...extra(x), blob, ...(vorschau ? { vorschau } : {}), groesse: blob.size + (vorschau?.size ?? 0) }];
  });
  const photos = wandle(speicher.photos ?? [], FOTO_FELDER, () => ({}));
  const backgrounds = wandle(speicher.backgrounds ?? [], BAUPLAN_FELDER, (b) => ({
    drehung: [0, 90, 180, 270].includes(b.drehung) ? b.drehung : 0,
    deckkraft: Number.isFinite(b.deckkraft) ? Math.min(1, Math.max(0, b.deckkraft)) : 0.5,
    sichtbar: b.sichtbar !== false,
  }));
  return { speicher: { ...speicher, photos, backgrounds }, ausgelassen };
}
