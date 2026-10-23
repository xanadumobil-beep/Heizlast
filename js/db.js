// Lokale Datenhaltung in IndexedDB. Alle Daten bleiben im Browser auf dem Gerät.
//
// Stores (jeweils mit Schlüssel "id"):
//   settings, zones, components, openingTypes, rooms, surfaces, radiators, consumption, meta
// Vorbereitet für spätere Stufen, aktuell leer:
//   photos, markers (Stufe 2: Fotos je Raum mit beschrifteten Markierungen)
//   scenarios       (Stufe 3: Szenarien mit überschriebenen U-Werten und Heizkörper-Status)

import { standardEinstellungen, standardZonen } from './schemas.js';

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
export const speichere = (store, objekt) => ausfuehren(store, 'readwrite', (s) => s.put(objekt));
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
