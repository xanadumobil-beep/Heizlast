// Sicherungsdatei: Format, Export, Prüfung beim Import und Sicherungsstatus.
// Reine Funktionen ohne Oberflächen- und Datenbankbezug. Die Datei ist ein JSON mit deutschen Schlüsseln,
// beschrieben in examples/format-beschreibung.md.
//
// Aufbau:
//   { format: 'heizlast-projekt', schemaVersion: 1, exportiertAm: ISO-Zeit, app: 'Heizlast',
//     daten: { einstellungen, zonen, bauteile, oeffnungstypen, raeume, raumflaechen, heizkoerper, verbrauch,
//              fotos, markierungen, szenarien } }
// Öffnungen stecken in den Raumflächen. Fotos, Markierungen und Szenarien sind für die Stufen 2 und 3 vorgesehen
// und derzeit leer.

import { standardEinstellungen, ZONENARTEN, BAUTEILARTEN, OEFFNUNGSARTEN, QUELLEN, STATI, GESCHOSSE, BAUARTEN_HK, HK_STATI, VENTILE, werte } from './schemas.js';
import { doppelteIds, migriereVerbrauch, kennlinieZuText, mitStabilenIds } from './modell.js';
import {
  validiereZone, validiereBauteil, validiereOeffnungstyp, validiereRaumEingabe, validiereHeizkoerper, validiereVerbrauch,
} from './validate.js';

export const FORMAT_KENNUNG = 'heizlast-projekt';
export const SCHEMA_VERSION = 1;
export const SICHERUNG_FRIST_TAGE = 14;

// Interner Speicher (IndexedDB) und Schlüssel in der Datei. Die Einstellungen sind ein einzelnes Objekt.
export const DATEI_SCHLUESSEL = {
  zones: 'zonen',
  components: 'bauteile',
  openingTypes: 'oeffnungstypen',
  rooms: 'raeume',
  surfaces: 'raumflaechen',
  radiators: 'heizkoerper',
  consumption: 'verbrauch',
  photos: 'fotos',
  markers: 'markierungen',
  scenarios: 'szenarien',
};

const TAG_MS = 24 * 60 * 60 * 1000;
const zwei = (n) => String(n).padStart(2, '0');

// Datum in lokaler Zeit als TT.MM.JJJJ.
export function datumText(zeit) {
  const d = new Date(zeit);
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function exportDateiname(jetzt = new Date()) {
  return `heizlast-sicherung-${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}.json`;
}

// --- Export ------------------------------------------------------------------------------

// speicher: { settings: [Einstellungen], zones: [...], components: [...], ... } wie aus der Datenbank.
export function baueExport(speicher, jetzt = new Date()) {
  const daten = { einstellungen: speicher.settings?.[0] ?? standardEinstellungen() };
  for (const [store, schluessel] of Object.entries(DATEI_SCHLUESSEL)) daten[schluessel] = speicher[store] ?? [];
  return { format: FORMAT_KENNUNG, schemaVersion: SCHEMA_VERSION, exportiertAm: jetzt.toISOString(), app: 'Heizlast', daten };
}

export const exportText = (export_) => `${JSON.stringify(export_, null, 2)}\n`;

// --- Import ------------------------------------------------------------------------------

function vollstaendigeEinstellungen(roh) {
  const standard = standardEinstellungen();
  const e = roh && typeof roh === 'object' ? roh : {};
  return {
    ...standard,
    ...e,
    id: 'projekt',
    luftwechselStandard: { ...standard.luftwechselStandard, ...e.luftwechselStandard },
    dUWB: { ...standard.dUWB, ...e.dUWB },
    aufheizzuschlag: { ...standard.aufheizzuschlag, ...e.aufheizzuschlag },
  };
}

const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Prüft die Struktur: Arrays, Kennungen, Eindeutigkeit. Fehler verhindern den Import.
function pruefeStruktur(daten, fehler) {
  for (const schluessel of Object.values(DATEI_SCHLUESSEL)) {
    const liste = daten[schluessel];
    if (liste === undefined) continue;
    if (!Array.isArray(liste)) {
      fehler.push(`„${schluessel}“ muss eine Liste sein.`);
      continue;
    }
    const gesehen = new Set();
    liste.forEach((eintrag, i) => {
      if (!istObjekt(eintrag)) {
        fehler.push(`„${schluessel}“, Eintrag ${i + 1}: kein Objekt.`);
      } else if (typeof eintrag.id !== 'string' || eintrag.id.trim() === '') {
        fehler.push(`„${schluessel}“, Eintrag ${i + 1}: Es fehlt die ID.`);
      } else if (gesehen.has(eintrag.id)) {
        fehler.push(`„${schluessel}“: Die ID „${eintrag.id}“ kommt doppelt vor.`);
      } else {
        gesehen.add(eintrag.id);
      }
    });
  }
  if (daten.einstellungen !== undefined && !istObjekt(daten.einstellungen)) fehler.push('„einstellungen“ muss ein Objekt sein.');
}

// Verweise zwischen den Einträgen. Fehlende Ziele sind Hinweise: die App markiert solche Einträge ohnehin.
function pruefeVerweise(d) {
  const hinweise = [];
  const ids = (liste) => new Set(liste.map((x) => x.id));
  const raeume = ids(d.rooms);
  const bauteile = ids(d.components);
  const zonen = ids(d.zones);
  const typen = ids(d.openingTypes);
  const raumName = (id) => d.rooms.find((r) => r.id === id)?.name ?? id;

  for (const f of d.surfaces) {
    const wo = `Raumfläche „${f.name || f.id}“ (Raum „${raumName(f.raumId)}“)`;
    if (!raeume.has(f.raumId)) hinweise.push(`${wo} gehört zu einem Raum, den es in der Datei nicht gibt.`);
    if (!bauteile.has(f.bauteilId)) hinweise.push(`${wo} verweist auf ein unbekanntes Bauteil.`);
    if (f.angrenzend?.art === 'zone' && !zonen.has(f.angrenzend.zoneId)) hinweise.push(`${wo} grenzt an eine unbekannte Zone.`);
    if (f.angrenzend?.art === 'raum' && !raeume.has(f.angrenzend.raumId)) hinweise.push(`${wo} grenzt an einen unbekannten Raum.`);
    for (const o of f.oeffnungen ?? []) {
      if (!typen.has(o.typId)) hinweise.push(`${wo}: Eine Öffnung verweist auf einen unbekannten Öffnungstyp.`);
    }
  }
  for (const h of d.radiators) {
    if (!raeume.has(h.raumId)) hinweise.push(`Heizkörper „${h.id}“ gehört zu einem Raum, den es in der Datei nicht gibt.`);
  }
  for (const r of d.rooms) {
    for (const l of r.waermeLieferanten ?? []) {
      if (!raeume.has(l.raumId)) hinweise.push(`Raum „${r.name}“: Ein Wärmelieferant ist in der Datei nicht vorhanden.`);
    }
  }
  return hinweise;
}

// Prüfregeln der App auf die Inhalte anwenden. Das sind Hinweise, kein Grund, den Import zu verweigern.
export function inhaltsHinweise(d) {
  const meldungen = [];
  const sammle = (bereich, name, liste) => {
    for (const m of liste) meldungen.push({ bereich, name, stufe: m.stufe, text: m.text });
  };
  for (const z of d.zones) sammle('Zone', z.name, validiereZone(z, werte(ZONENARTEN)));
  for (const b of d.components) sammle('Bauteil', b.name, validiereBauteil(b, werte(BAUTEILARTEN), werte(QUELLEN)));
  for (const o of d.openingTypes) sammle('Öffnungstyp', o.name, validiereOeffnungstyp(o, werte(OEFFNUNGSARTEN), werte(QUELLEN)));
  for (const r of d.rooms) sammle('Raum', r.name, validiereRaumEingabe(r, { stati: werte(STATI), geschosse: werte(GESCHOSSE) }));
  const optionen = { bauarten: werte(BAUARTEN_HK), stati: werte(HK_STATI), ventile: werte(VENTILE) };
  for (const h of d.radiators) {
    const raum = d.rooms.find((r) => r.id === h.raumId);
    sammle(`Heizkörper in „${raum?.name ?? '?'}“`, h.id, validiereHeizkoerper({ ...h, kennlinieText: kennlinieZuText(h.kennlinie) }, optionen));
  }
  for (const v of d.consumption) sammle('Verbrauchsabgleich', v.name, validiereVerbrauch(v));
  return meldungen;
}

// Prüft den Inhalt einer Sicherungsdatei. Rückgabe:
//   { ok: false, fehler: [Text] }
//   { ok: true, daten (interner Speicher), exportiertAm, zusammenfassung, verweise, inhalt }
// Fehler: kein JSON, falsche Kennung, unbekannte Version, kaputte Struktur, doppelte oder fehlende IDs.
export function pruefeImport(text) {
  let datei;
  try {
    datei = JSON.parse(text);
  } catch {
    return { ok: false, fehler: ['Die Datei ist kein gültiges JSON. Bitte eine Sicherungsdatei aus der Heizlast-App wählen.'] };
  }
  if (!istObjekt(datei) || datei.format !== FORMAT_KENNUNG) {
    return { ok: false, fehler: ['Das ist keine Heizlast-Sicherung (die Kennung „heizlast-projekt“ fehlt).'] };
  }
  if (!Number.isInteger(datei.schemaVersion) || datei.schemaVersion < 1) {
    return { ok: false, fehler: ['Die Formatversion der Datei fehlt oder ist ungültig.'] };
  }
  if (datei.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      fehler: [`Die Datei hat Formatversion ${datei.schemaVersion}. Diese App kennt nur Version ${SCHEMA_VERSION}. Bitte die App aktualisieren.`],
    };
  }
  if (!istObjekt(datei.daten)) return { ok: false, fehler: ['Im Feld „daten“ fehlen die Projektdaten.'] };

  const fehler = [];
  pruefeStruktur(datei.daten, fehler);
  if (fehler.length > 0) return { ok: false, fehler };

  const speicher = { settings: [vollstaendigeEinstellungen(datei.daten.einstellungen)] };
  for (const [store, schluessel] of Object.entries(DATEI_SCHLUESSEL)) speicher[store] = datei.daten[schluessel] ?? [];
  speicher.consumption = speicher.consumption.map(migriereVerbrauch);
  // IDs ergänzen, wo es erlaubt ist (Öffnungen ohne ID), damit sie danach dauerhaft sind.
  speicher.surfaces = speicher.surfaces.map((f) => mitStabilenIds('surfaces', f, () => `oeffnung-${Math.random().toString(36).slice(2, 12)}`));

  const doppelt = doppelteIds({ flaechen: speicher.surfaces, heizkoerper: speicher.radiators });
  if (doppelt.length > 0) {
    return { ok: false, fehler: doppelt.map((d) => `Die Kennung „${d.split(':')[1]}“ kommt mehrfach vor (${d.startsWith('oeffnung') ? 'Öffnungen' : 'Heizkörper'}).`) };
  }

  return {
    ok: true,
    daten: speicher,
    exportiertAm: typeof datei.exportiertAm === 'string' ? datei.exportiertAm : null,
    zusammenfassung: zusammenfassung(speicher),
    verweise: pruefeVerweise(speicher),
    inhalt: inhaltsHinweise(speicher),
  };
}

// Anzahl der Einträge, gleiche Form für die Datei und für die aktuellen Daten.
export function zusammenfassung(speicher) {
  const anzahl = (store) => (speicher[store] ?? []).length;
  return {
    zonen: anzahl('zones'),
    bauteile: anzahl('components'),
    oeffnungstypen: anzahl('openingTypes'),
    raeume: anzahl('rooms'),
    raumflaechen: anzahl('surfaces'),
    oeffnungen: (speicher.surfaces ?? []).reduce((s, f) => s + (f.oeffnungen ?? []).length, 0),
    heizkoerper: anzahl('radiators'),
    verbrauch: anzahl('consumption'),
  };
}

export const ZUSAMMENFASSUNG_NAMEN = {
  zonen: 'Zonen',
  bauteile: 'Bauteile',
  oeffnungstypen: 'Öffnungstypen',
  raeume: 'Räume',
  raumflaechen: 'Raumflächen',
  oeffnungen: 'Öffnungen',
  heizkoerper: 'Heizkörper',
  verbrauch: 'Verbrauchsabgleiche',
};

// --- Sicherungsstatus --------------------------------------------------------------------

// Wie alt ist die letzte Sicherung? Ohne Sicherung zählt der Beginn der Nutzung.
// überfällig: älter als 14 Tage. Eingaben sind ISO-Zeiten oder Date.
export function sicherungsStatus({ jetzt, letzteSicherung, start }) {
  const nie = !letzteSicherung;
  const referenz = letzteSicherung ?? start ?? null;
  if (!referenz) return { nie, tage: 0, ueberfaellig: false, referenz: null };
  const vergangen = new Date(jetzt).getTime() - new Date(referenz).getTime();
  return {
    nie,
    tage: Math.max(0, Math.floor(vergangen / TAG_MS)),
    ueberfaellig: vergangen > SICHERUNG_FRIST_TAGE * TAG_MS,
    referenz,
  };
}

// Text für das Hinweis-Banner, oder null, wenn die Sicherung aktuell ist.
export function bannerText(status) {
  if (!status.ueberfaellig) return null;
  if (status.nie) {
    return `Noch nie gesichert, die App wird seit ${status.tage} Tagen genutzt. Bitte jetzt eine Sicherungsdatei exportieren.`;
  }
  return `Die letzte Sicherung ist ${status.tage} Tage alt (vom ${datumText(status.referenz)}). Bitte jetzt eine neue Sicherungsdatei exportieren.`;
}

// Projektstand in der Form, die Rechenkern, Bericht und Anzeige nutzen, aus dem internen Speicher (Datenbank, Import).
export function projektAusSpeicher(speicher) {
  const nachName = (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'de');
  return {
    einstellungen: speicher.settings[0],
    zonen: [...speicher.zones].sort(nachName),
    bauteile: [...speicher.components].sort(nachName),
    oeffnungstypen: [...speicher.openingTypes].sort(nachName),
    raeume: [...speicher.rooms].sort(nachName),
    flaechen: speicher.surfaces,
    heizkoerper: speicher.radiators,
    verbrauch: [...speicher.consumption].sort(nachName),
  };
}
