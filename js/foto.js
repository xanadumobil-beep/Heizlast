// Fotos und Markierungen: reine Hilfsfunktionen ohne Oberfläche und ohne Datenbank.
//
// Foto (Speicher "photos"): { id, raumId, titel, notiz, datum (ISO), breite, hoehe, blob (JPEG), vorschau (kleines JPEG), groesse (Byte) }
// Markierung (Speicher "markers"): { id, fotoId, raumId, x, y (Prozent des Bildes, 0 bis 100),
//   ziel: { art: 'oeffnung' | 'heizkoerper' | 'flaeche', id } | null, beschriftung, auto }
//   auto: Die Beschriftung folgt der Verknüpfung (z. B. „F1 Hebeschiebeanlage“) und wird bei jeder Anzeige neu gebildet.
//   Ändert jemand den Text, ist auto false. Fehlt das verknüpfte Element, bleibt die Markierung mit dem zuletzt
//   gespeicherten Text erhalten und trägt den Hinweis „Verknüpfung fehlt“.
// Bauplan (Speicher "backgrounds"): { id: "bg-<Geschoss>", geschoss, blob, breite, hoehe, drehung (0, 90, 180, 270), deckkraft (0 bis 1),
//   sichtbar, groesse }

import { formatZahl } from './engine/format.js';
import { label, BAUARTEN_HK, HK_TYPEN, OEFFNUNGSARTEN } from './schemas.js';
import { flaechenBezeichnung } from './anzeige.js';

export const FOTO_MAX_SEITE = 2048;
export const FOTO_QUALITAET = 0.8;
export const VORSCHAU_MAX_SEITE = 400;
export const BAUPLAN_MAX_SEITE = 2560;
export const BAUPLAN_QUALITAET = 0.85;

// Größe nach dem Verkleinern: die lange Seite höchstens maxSeite, das Seitenverhältnis bleibt, nie vergrößern.
export function zielGroesse(breite, hoehe, maxSeite = FOTO_MAX_SEITE) {
  const lang = Math.max(breite, hoehe);
  if (!(lang > 0)) return { breite: 0, hoehe: 0, faktor: 1 };
  const faktor = Math.min(1, maxSeite / lang);
  return { breite: Math.max(1, Math.round(breite * faktor)), hoehe: Math.max(1, Math.round(hoehe * faktor)), faktor };
}

export const bytesText = (bytes) => (bytes >= 1024 * 1024 * 1024
  ? `${formatZahl(bytes / 1024 / 1024 / 1024, 2)} GB`
  : bytes >= 1024 * 1024 ? `${formatZahl(bytes / 1024 / 1024, 1)} MB` : `${formatZahl(bytes / 1024, 0)} KB`);

// --- Elemente eines Raums für die Verknüpfung ------------------------------------------------------

// Öffnungen des Raums in der Reihenfolge der Raumflächen. Fenster heißen F1, F2 …, Türen T1, T2 …
export function oeffnungenDesRaums(projekt, raumId) {
  const zaehler = { fenster: 0, tuer: 0 };
  const liste = [];
  for (const f of projekt.flaechen.filter((x) => x.raumId === raumId)) {
    for (const o of f.oeffnungen ?? []) {
      const typ = projekt.oeffnungstypen.find((t) => t.id === o.typId);
      const art = typ?.art === 'tuer' ? 'tuer' : 'fenster';
      zaehler[art] += 1;
      const kuerzel = `${art === 'tuer' ? 'T' : 'F'}${zaehler[art]}`;
      liste.push({ art: 'oeffnung', id: o.id, kuerzel, text: `${kuerzel} ${o.name || typ?.name || label(OEFFNUNGSARTEN, art)}`, flaecheId: f.id });
    }
  }
  return liste;
}

// Heizkörper des Raums in der gespeicherten Reihenfolge: HK1, HK2 … mit „Typ 22“ bei Plattenheizkörpern, sonst der Bauart.
export function heizkoerperDesRaums(projekt, raumId) {
  return projekt.heizkoerper.filter((h) => h.raumId === raumId).map((h, i) => {
    const kuerzel = `HK${i + 1}`;
    const beschreibung = h.bauart === 'platten' && h.typ ? `Typ ${label(HK_TYPEN, h.typ)}` : label(BAUARTEN_HK, h.bauart);
    return { art: 'heizkoerper', id: h.id, kuerzel, text: `${kuerzel} ${beschreibung}` };
  });
}

// Raumflächen: Fl1, Fl2 … mit ihrer Bezeichnung.
export function flaechenDesRaums(projekt, raumId) {
  return projekt.flaechen.filter((f) => f.raumId === raumId).map((f, i) => {
    const kuerzel = `Fl${i + 1}`;
    return { art: 'flaeche', id: f.id, kuerzel, text: `${kuerzel} ${flaechenBezeichnung(projekt, f)}` };
  });
}

// Alle Verknüpfungsziele eines Raums, gruppiert für die Auswahlliste.
export function verknuepfungsZiele(projekt, raumId) {
  return {
    oeffnung: oeffnungenDesRaums(projekt, raumId),
    heizkoerper: heizkoerperDesRaums(projekt, raumId),
    flaeche: flaechenDesRaums(projekt, raumId),
  };
}

// Anzeigetext einer Markierung und ob die Verknüpfung fehlt.
// Rückgabe: { text, fehlt, verknuepft }. Ohne Verknüpfung (frei beschriftet) ist fehlt false.
export function markierungsText(projekt, marker) {
  if (!marker.ziel) return { text: marker.beschriftung || 'Markierung', fehlt: false, verknuepft: false };
  const ziele = verknuepfungsZiele(projekt, marker.raumId);
  const treffer = ziele[marker.ziel.art]?.find((z) => z.id === marker.ziel.id);
  if (!treffer) return { text: marker.beschriftung || 'Markierung', fehlt: true, verknuepft: true };
  return { text: marker.auto ? treffer.text : (marker.beschriftung || treffer.text), fehlt: false, verknuepft: true };
}

// Beschriftung, die beim Verknüpfen gespeichert wird (zuletzt bekannter Text, falls das Element später gelöscht wird).
export function beschriftungFuerZiel(projekt, raumId, ziel) {
  if (!ziel) return '';
  return verknuepfungsZiele(projekt, raumId)[ziel.art]?.find((z) => z.id === ziel.id)?.text ?? '';
}

export function neueMarkierung(id, foto, x, y) {
  return { id, fotoId: foto.id, raumId: foto.raumId, x: runde(x), y: runde(y), ziel: null, beschriftung: '', auto: true };
}

const runde = (x) => Math.round(Math.min(100, Math.max(0, x)) * 100) / 100;
export const begrenzeProzent = runde;

// Markierungen, die auf ein Element zeigen, mit ihrem Foto: [{ markierung, foto }], nach Fotodatum.
export function markierungenFuerZiel(markierungen, fotos, art, id) {
  return markierungen
    .filter((m) => m.ziel && m.ziel.art === art && m.ziel.id === id)
    .map((m) => ({ markierung: m, foto: fotos.find((f) => f.id === m.fotoId) }))
    .filter((x) => x.foto)
    .sort((a, b) => (a.foto.datum ?? '').localeCompare(b.foto.datum ?? ''));
}

export const sortiereFotos = (fotos) => [...fotos].sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? '') || (a.titel ?? '').localeCompare(b.titel ?? '', 'de'));

// Foto ohne Bilddaten (für Listen, Verknüpfungen und das Projekt, das Berechnung und Bericht nutzen).
export const fotoMeta = ({ blob, vorschau, bild, ...rest }) => rest;

// Datum als TT.MM.JJJJ (leer bei ungültigem Wert).
export function datumKurz(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export const fotoTitelVorgabe = (anzahl) => `Foto ${anzahl + 1}`;

// Eintrag für den Bericht: ein Foto je Raum mit seinen Markierungen (Position in Prozent und Text).
export function fotoAnhang(projekt, fotos, markierungen, auswahl = {}) {
  const eintraege = [];
  for (const raum of projekt.raeume) {
    const eigene = sortiereFotos(fotos.filter((f) => f.raumId === raum.id));
    if (eigene.length === 0) continue;
    const foto = eigene.find((f) => f.id === auswahl[raum.id]) ?? eigene[0];
    eintraege.push({
      raumId: raum.id,
      raumName: raum.name,
      fotoId: foto.id,
      titel: foto.titel,
      notiz: foto.notiz,
      datum: foto.datum,
      breite: foto.breite,
      hoehe: foto.hoehe,
      markierungen: markierungen.filter((m) => m.fotoId === foto.id).map((m, i) => {
        const t = markierungsText(projekt, m);
        return { nr: i + 1, x: m.x, y: m.y, text: t.text, fehlt: t.fehlt };
      }),
    });
  }
  return eintraege;
}

