// Lokale Datenhaltung in IndexedDB. Alle Daten bleiben im Browser auf dem Gerät.
//
// Stores (jeweils mit Schlüssel "id"):
//   settings, zones, components, openingTypes, rooms, surfaces, radiators, consumption, meta
// Stufe 2: photos (Fotos je Raum, Blob), markers (Markierungen auf Fotos), backgrounds (Bauplan je Geschoss, Blob)
// Stufe 3: scenarios (Szenarien mit Abweichungen gegenüber dem Ist-Zustand)
// Geräteprüfung: heatpumps (Wärmepumpen-Katalog, unabhängig vom Haus und deshalb auch im Szenario-Betrieb bearbeitbar)

import { standardEinstellungen, standardZonen } from './schemas.js';
import { mitStabilenIds } from './modell.js';

const DB_NAME = 'heizlast';
const DB_VERSION = 3; // 2: Speicher "backgrounds" für die Baupläne, 3: Speicher "heatpumps" für den Wärmepumpen-Katalog

export const STORES = [
  'settings', 'zones', 'components', 'openingTypes', 'rooms', 'surfaces', 'radiators', 'consumption', 'meta',
  'photos', 'markers', 'scenarios', 'backgrounds', 'heatpumps',
];

let dbPromise = null;

// --- Schreibschutz im Szenario-Betrieb ---------------------------------------------------------------
//
// Solange ein Szenario aktiv ist, zeigen alle Ansichten die Werte des Szenarios. Die Bestandsdaten (Ist-Zustand)
// dürfen dann nicht geändert werden, sonst würden Szenario-Werte aus der Ansicht in den Ist-Zustand zurückgeschrieben.
// Diese Sperre sitzt in der Datenschicht, damit keine Ansicht sie vergessen kann. Offen bleiben nur die Szenarien selbst
// ('scenarios'), die Statusangaben ('meta') und die Plan-Positionen über speicherePlan().
let schreibschutz = false;
const GESCHUETZT = new Set(['settings', 'zones', 'components', 'openingTypes', 'rooms', 'surfaces', 'radiators', 'consumption', 'photos', 'markers']);

export class SchreibschutzFehler extends Error {
  constructor() {
    super('Ein Szenario ist aktiv: Die Bestandsdaten sind schreibgeschützt. Bitte zum Ist-Zustand wechseln.');
    this.name = 'SchreibschutzFehler';
  }
}

export const setzeSchreibschutz = (an) => { schreibschutz = Boolean(an); };
export const istSchreibgeschuetzt = () => schreibschutz;
function pruefeSchreibzugriff(store) {
  if (schreibschutz && GESCHUETZT.has(store)) throw new SchreibschutzFehler();
}

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
export async function speichere(store, objekt) {
  pruefeSchreibzugriff(store);
  return ausfuehren(store, 'readwrite', (s) => s.put(mitStabilenIds(store, objekt, neueId)));
}
export async function loesche(store, id) {
  pruefeSchreibzugriff(store);
  return ausfuehren(store, 'readwrite', (s) => s.delete(id));
}

// Plan-Position eines Raums oder einer Zone speichern (plan: { x, y } oder null). Das ist reines Layout und bleibt im
// Szenario-Betrieb erlaubt. Gelesen wird der Datensatz des Ist-Zustands aus der Datenbank, nie ein für das Szenario
// veränderter Datensatz aus der Ansicht, und nur das Feld "plan" wird geändert.
export async function speicherePlan(store, id, plan) {
  const aktuell = await lade(store, id);
  if (!aktuell) return;
  const neu = { ...aktuell };
  if (plan) neu.plan = plan; else delete neu.plan;
  await ausfuehren(store, 'readwrite', (s) => s.put(neu));
}

// Annahmen für die Jahreswärme-Differenz (einstellungen.vergleich). Das sind Vergleichsannahmen und keine Bestandsdaten, sie bleiben im
// Szenario-Betrieb bearbeitbar. Geschrieben wird nur das Feld "vergleich" an den Einstellungen des Ist-Zustands.
export async function speichereVergleichsannahmen(annahmen) {
  const aktuell = await ladeEinstellungen();
  await ausfuehren('settings', 'readwrite', (s) => s.put({ ...aktuell, vergleich: annahmen }));
}

// Annahmen zur Wärmepumpe (einstellungen.waermepumpe, derzeit die Sperrstunden des Netzbetreibers). Wie die Vergleichsannahmen
// sind das Eingaben für die Auslegung und keine Bestandsdaten, sie bleiben im Szenario-Betrieb bearbeitbar.
export async function speichereWaermepumpenannahmen(annahmen) {
  const aktuell = await ladeEinstellungen();
  await ausfuehren('settings', 'readwrite', (s) => s.put({ ...aktuell, waermepumpe: annahmen }));
}

// Umfang der Fotos und Baupläne im Speicher: Anzahl und Byte (Bild und Vorschau).
export async function fotoSpeicher() {
  const [fotos, hintergruende] = await Promise.all([alle('photos'), alle('backgrounds')]);
  const bytes = (liste) => liste.reduce((s, x) => s + (x.groesse ?? ((x.blob?.size ?? 0) + (x.vorschau?.size ?? 0))), 0);
  return { fotos: fotos.length, hintergruende: hintergruende.length, bytes: bytes(fotos) + bytes(hintergruende), bytesFotos: bytes(fotos), bytesHintergruende: bytes(hintergruende) };
}

// Aktives Szenario (null = Ist-Zustand). Der Zustand liegt in "meta" und gehört nicht zur Sicherungsdatei.
export async function ladeAktivesSzenarioId() {
  return (await lade('meta', 'aktivesSzenario'))?.szenarioId ?? null;
}
export const speichereAktivesSzenarioId = (szenarioId) => ausfuehren('meta', 'readwrite', (s) => s.put({ id: 'aktivesSzenario', szenarioId }));

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
  'zones', 'components', 'openingTypes', 'rooms', 'surfaces', 'radiators', 'consumption', 'photos', 'markers', 'scenarios', 'backgrounds', 'heatpumps',
];

// Fotos, Markierungen und Baupläne: Sie lassen sich beim Import auf Wunsch behalten (siehe ersetzeAlles).
export const FOTO_STORES = ['photos', 'markers', 'backgrounds'];

// Alle Projektdaten, die Einstellungen als Liste mit einem Eintrag (vollständig, mit Standardwerten ergänzt).
export async function ladeAlles() {
  const speicher = { settings: [await ladeEinstellungen()] };
  for (const name of DATEN_STORES) speicher[name] = await alle(name);
  return speicher;
}

// Ersetzt alle Projektdaten in EINER Transaktion: schlägt etwas fehl, bleibt der alte Stand vollständig erhalten.
// Die Markierung "init" bleibt erhalten, damit die Standardzone nicht wieder erscheint und der Beginn der Nutzung gilt.
// behalteFotos: Fotos, Markierungen und Baupläne werden weder gelöscht noch aus dem Speicher überschrieben
// (für Dateien ohne Fotos, wenn die vorhandenen Fotos erhalten bleiben sollen).
// behalteKatalog: Der Wärmepumpen-Katalog bleibt unverändert (für ältere Dateien, die keinen Katalog enthalten).
export async function ersetzeAlles(speicher, sicherung = null, { behalteFotos = false, behalteKatalog = false } = {}) {
  if (schreibschutz) throw new SchreibschutzFehler();
  const bisher = await lade('meta', 'init');
  const db = await oeffneDb();
  await new Promise((erfolg, fehler) => {
    const transaktion = db.transaction([...DATEN_STORES, 'settings', 'meta'], 'readwrite');
    transaktion.oncomplete = () => erfolg();
    transaktion.onerror = () => fehler(transaktion.error);
    transaktion.onabort = () => fehler(transaktion.error);
    try {
      const behalten = (n) => (behalteFotos && FOTO_STORES.includes(n)) || (behalteKatalog && n === 'heatpumps');
      const stores = [...DATEN_STORES, 'settings'].filter((n) => !behalten(n));
      for (const name of stores) transaktion.objectStore(name).clear();
      for (const [name, liste] of Object.entries(speicher)) {
        if (behalten(name)) continue;
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

// Wärmepumpen-Katalog aus einer Katalogdatei übernehmen, ohne Hausdaten zu berühren. modus 'ersetzen': der Katalog wird ersetzt,
// 'hinzufuegen': Geräte kommen dazu, gleiche Kennungen werden überschrieben. Alles in einer Transaktion.
export async function uebernehmeKatalog(geraete, modus) {
  const db = await oeffneDb();
  await new Promise((erfolg, fehler) => {
    const transaktion = db.transaction('heatpumps', 'readwrite');
    transaktion.oncomplete = () => erfolg();
    transaktion.onerror = () => fehler(transaktion.error);
    transaktion.onabort = () => fehler(transaktion.error);
    const store = transaktion.objectStore('heatpumps');
    if (modus === 'ersetzen') store.clear();
    for (const g of geraete) store.put(g);
  });
}

// Zeitpunkt der letzten Sicherung (Export oder Import einer Sicherungsdatei).
export const speichereSicherung = (sicherung) => speichere('meta', { id: 'sicherung', ...sicherung });
export const ladeSicherung = () => lade('meta', 'sicherung');
