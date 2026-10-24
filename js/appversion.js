// Version der App: welche Dateien auf dem Gerät liegen, was online verfügbar ist, und Hilfen, wenn eine
// Home-Bildschirm-App an einer alten Version hängt. Die Eingaben (IndexedDB) werden dabei nie angefasst.

const PRAEFIX = 'heizlast-';

// Version der zwischengespeicherten Dateien auf dem Gerät, oder null (kein Service Worker, kein Speicher).
export async function installierteVersion() {
  if (!globalThis.caches) return null;
  const namen = (await caches.keys()).filter((n) => n.startsWith(PRAEFIX)).sort();
  return namen.length > 0 ? namen[namen.length - 1].slice(PRAEFIX.length) : null;
}

// Aktuelle Version auf dem Server: { version, erstellt } aus sw.js, am Zwischenspeicher vorbei geholt.
export async function onlineVersion() {
  const antwort = await fetch(`sw.js?pruefung=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
  if (!antwort.ok) throw new Error(`Status ${antwort.status}`);
  const text = await antwort.text();
  return {
    version: /const VERSION = '([^']+)'/.exec(text)?.[1] ?? null,
    erstellt: /const ERSTELLT = '([^']+)'/.exec(text)?.[1] ?? null,
  };
}

// Lässt den Service Worker nach einer neuen Version suchen. Rückgabe: 'neu' (wird geladen), 'aktuell' oder 'nicht_moeglich'.
export async function sucheUpdate() {
  if (!('serviceWorker' in navigator)) return 'nicht_moeglich';
  const registrierung = await navigator.serviceWorker.getRegistration();
  if (!registrierung) return 'nicht_moeglich';
  await registrierung.update();
  return registrierung.installing || registrierung.waiting ? 'neu' : 'aktuell';
}

// Löscht den App-Speicher und meldet den Service Worker ab, danach lädt die Seite neu und holt alles frisch.
//
// Das ist bewusst auf zwei Dinge beschränkt: (1) die Cache-Speicher mit dem Namen "heizlast-…" (die Programmdateien:
// HTML, Skripte, Stile, Symbole) und (2) die Anmeldung des Service Workers. Diese Funktion berührt IndexedDB nicht:
// Projektdaten, Einstellungen, Plan-Positionen und Sicherungsstatus liegen dort und bleiben unverändert.
// Ein Test (tests/offline.test.js) stellt sicher, dass hier kein Zugriff auf indexedDB erfolgt.
export async function leereAppSpeicher() {
  if (globalThis.caches) {
    for (const name of await caches.keys()) {
      if (name.startsWith(PRAEFIX)) await caches.delete(name);
    }
  }
  if ('serviceWorker' in navigator) {
    for (const registrierung of await navigator.serviceWorker.getRegistrations()) await registrierung.unregister();
  }
  location.reload();
}

export function datumUhrzeit(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zwei = (n) => String(n).padStart(2, '0');
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}, ${zwei(d.getHours())}:${zwei(d.getMinutes())} Uhr`;
}
