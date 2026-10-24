// Service Worker: macht die App offline nutzbar. Alle App-Dateien werden beim Installieren
// zwischengespeichert und danach zuerst aus dem Speicher geliefert.
// Eine neue Version (geänderte VERSION) ersetzt den alten Speicher vollständig.

// --- erzeugt von tools/sw-aktualisieren.js, nicht von Hand ändern ---
const VERSION = '16943dad7c';
const DATEIEN = [
  "./",
  "css/print.css",
  "css/style.css",
  "examples/beispiel-mini-haus.json",
  "examples/format-beschreibung.md",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "index.html",
  "js/anzeige.js",
  "js/app.js",
  "js/banner.js",
  "js/bericht.js",
  "js/daten.js",
  "js/db.js",
  "js/dialog.js",
  "js/engine/format.js",
  "js/engine/heatload.js",
  "js/engine/radiator.js",
  "js/engine/verbrauch.js",
  "js/engine/vorlauf.js",
  "js/io.js",
  "js/modell.js",
  "js/persist.js",
  "js/schemas.js",
  "js/ui.js",
  "js/validate.js",
  "js/views/bericht.js",
  "js/views/einstellungen.js",
  "js/views/heizkoerper.js",
  "js/views/katalog.js",
  "js/views/raeume.js",
  "js/views/sicherung.js",
  "js/views/verbrauch.js",
  "js/views/vorlauf.js",
  "manifest.webmanifest"
];
// --- Ende des erzeugten Teils ---

const SPEICHER = `heizlast-${VERSION}`;

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(
    caches.open(SPEICHER).then((speicher) => speicher.addAll(DATEIEN)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n.startsWith('heizlast-') && n !== SPEICHER).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET' || new URL(anfrage.url).origin !== self.location.origin) return;
  ereignis.respondWith(
    caches.match(anfrage, { ignoreSearch: true }).then((treffer) => treffer ?? fetch(anfrage)),
  );
});
