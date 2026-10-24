// Lokale Datenhaltung in IndexedDB. Alle Daten bleiben im Browser auf dem Gerät.
//
// Stores (jeweils mit Schlüssel "id"):
//   settings, zones, components, openingTypes, rooms, surfaces, radiators, consumption, meta
// Vorbereitet für spätere Stufen, aktuell leer:
//   photos, markers (Stufe 2: Fotos je Raum mit beschrifteten Markierungen)
//   scenarios       (Stufe 3: Szenarien mit überschriebenen U-Werten und Heizkörper-Status)

import { standardEinstellungen, standardZonen } from './schemas.js';
import { mitStabilenIds } from './modell.js';

const DB_NAME = 'heizlast';
const DB_VERSION = 1;

export const STORES = [
  'settings', 'zones', 'components', 'openingTypes', 'rooms', 'surfaces', 'radiators', 'consumption', 'meta',
  'photos', 'markers', 'scenarios',
];

let dbPromise = null;

export function oeffneDb() {
  if (!dbPromise) {
    dbPromise = new Promise((erfolg, fehler) => {
      const anfrage = indexedDB.open(DB_NAME, DB_VERSION);
      anfrage.onupgradeneeded = () => {
        const db = anfrage.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      anfrage.onsuccess = () => erfolg(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error);
      anfrage.onblocked = () => fehler(new Error('Datenbank ist durch einen anderen Tab blockiert.'));
    });
  }
  return dbPromise;
}

async function ausfuehren(store, modus, aktion) {
  const db = await oeffneDb();
  return new Promise((erfolg, fehler) => {
    const transaktion = db.transaction(store, modus);
    const anfrage = aktion(transaktion.objectStore(store));
    transaktion.oncomplete = () => erfolg(anfrage.result);
    transaktion.onerror = () => fehler(transaktion.error);
    transaktion.onabort = () => fehler(transaktion.error);
  });
}

export const alle = (store) => ausfuehren(store, 'readonly', (s) => s.getAll());
export const lade = (store, id) => ausfuehren(store, 'readonly', (s) => s.get(id));
// Beim Speichern bekommen Öffnungen und Heizkörper, falls nötig, eine dauerhafte ID (siehe mitStabilenIds).
export const speichere = (store, objekt) => ausfuehren(store, 'readwrite', (s) => s.put(mitStabilenIds(store, objekt, neueId)));
export const loesche = (store, id) => ausfuehren(store, 'readwrite', (s) => s.delete(id));

export function neueId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Beim ersten Start Standardwerte anlegen. Die Markierung in "meta" verhindert,
// dass gelöschte Standard-Zonen später wieder auftauchen.
export async function stelleStandardsSicher() {
  if (await lade('meta', 'init')) return;
  await speichere('settings', standardEinstellungen());
  for (const zone of standardZonen()) await speichere('zones', zone);
  await speichere('meta', { id: 'init', datum: new Date().toISOString() });
}

// Gespeicherte Einstellungen, ergänzt um Standardwerte für später hinzugekommene Felder.
export async function ladeEinstellungen() {
  const standard = standardEinstellungen();
  const gespeichert = (await lade('settings', 'projekt')) ?? {};
  return {
    ...standard,
    ...gespeichert,
    luftwechselStandard: { ...standard.luftwechselStandard, ...gespeichert.luftwechselStandard },
    dUWB: { ...standard.dUWB, ...gespeichert.dUWB },
    aufheizzuschlag: { ...standard.aufheizzuschlag, ...gespeichert.aufheizzuschlag },
  };
}

// --- Sicherung: alles lesen, alles atomar ersetzen --------------------------------------------

// Stores mit Projektdaten (ohne Einstellungen und meta).
export const DATEN_STORES = [
  'zones', 'components', 'openingTypes', 'rooms', 'surfaces', 'radiators', 'consumption', 'photos', 'markers', 'scenarios',
];

// Alle Projektdaten, die Einstellungen als Liste mit einem Eintrag (vollständig, mit Standardwerten ergänzt).
export async function ladeAlles() {
  const speicher = { settings: [await ladeEinstellungen()] };
  for (const name of DATEN_STORES) speicher[name] = await alle(name);
  return speicher;
}

// Ersetzt alle Projektdaten in EINER Transaktion: schlägt etwas fehl, bleibt der alte Stand vollständig erhalten.
// Die Markierung "init" bleibt erhalten, damit die Standardzone nicht wieder erscheint und der Beginn der Nutzung gilt.
export async function ersetzeAlles(speicher, sicherung = null) {
  const bisher = await lade('meta', 'init');
  const db = await oeffneDb();
  await new Promise((erfolg, fehler) => {
    const transaktion = db.transaction([...DATEN_STORES, 'settings', 'meta'], 'readwrite');
    transaktion.oncomplete = () => erfolg();
    transaktion.onerror = () => fehler(transaktion.error);
    transaktion.onabort = () => fehler(transaktion.error);
    try {
      for (const name of [...DATEN_STORES, 'settings']) transaktion.objectStore(name).clear();
      for (const [name, liste] of Object.entries(speicher)) {
        for (const objekt of liste) transaktion.objectStore(name).put(mitStabilenIds(name, objekt, neueId));
      }
      transaktion.objectStore('meta').put(bisher ?? { id: 'init', datum: new Date().toISOString() });
      if (sicherung) transaktion.objectStore('meta').put({ id: 'sicherung', ...sicherung });
    } catch (ausnahme) {
      // Ein Fehler mitten im Schreiben darf keinen halben Stand hinterlassen: die Transaktion wird abgebrochen.
      try { transaktion.abort(); } catch { /* schon beendet */ }
      fehler(ausnahme);
    }
  });
}

// Zeitpunkt der letzten Sicherung (Export oder Import einer Sicherungsdatei).
export const speichereSicherung = (sicherung) => speichere('meta', { id: 'sicherung', ...sicherung });
export const ladeSicherung = () => lade('meta', 'sicherung');
