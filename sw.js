// Service Worker: macht die App offline nutzbar. Alle App-Dateien werden beim Installieren
// zwischengespeichert und danach zuerst aus dem Speicher geliefert.
// Eine neue Version (geänderte VERSION) ersetzt den alten Speicher vollständig.

// --- erzeugt von tools/sw-aktualisieren.js, nicht von Hand ändern ---
const VERSION = 'facdbc8cb7';
const ERSTELLT = '2026-10-24T11:37:33.544Z';
const DATEIEN = [
  "./",
  "css/print.css",
  "css/style.css",
  "examples/beispiel-mini-haus.json",
  "examples/beispiel-waermepumpen.json",
  "examples/format-beschreibung.md",
  "examples/format-katalog.md",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "index.html",
  "js/anzeige.js",
  "js/app.js",
  "js/appversion.js",
  "js/banner.js",
  "js/bericht.js",
  "js/bild.js",
  "js/daten.js",
  "js/db.js",
  "js/dialog.js",
  "js/engine/format.js",
  "js/engine/heatload.js",
  "js/engine/radiator.js",
  "js/engine/verbrauch.js",
  "js/engine/vorlauf.js",
  "js/ergebnis.js",
  "js/foto.js",
  "js/fotoexport.js",
  "js/geraete.js",
  "js/io.js",
  "js/jahreswaerme.js",
  "js/modell.js",
  "js/navigation.js",
  "js/persist.js",
  "js/plan.js",
  "js/planlayout.js",
  "js/planzeichnung.js",
  "js/schemas.js",
  "js/schutz.js",
  "js/szenario.js",
  "js/ui.js",
  "js/validate.js",
  "js/vergleich.js",
  "js/views/bericht.js",
  "js/views/einstellungen.js",
  "js/views/ergebnis.js",
  "js/views/fotos.js",
  "js/views/heizkoerper.js",
  "js/views/katalog.js",
  "js/views/plan.js",
  "js/views/raeume.js",
  "js/views/sicherung.js",
  "js/views/szenarien.js",
  "js/views/verbrauch.js",
  "js/views/vorlauf.js",
  "js/views/waermepumpen.js",
  "manifest.webmanifest"
];
// --- Ende des erzeugten Teils ---

const SPEICHER = `heizlast-${VERSION}`;

// Beim Installieren werden die Dateien am Zwischenspeicher des Browsers vorbei geholt ("reload"). Sonst könnte eine
// neue Version versehentlich noch die alten Dateien übernehmen, die GitHub Pages bis zu 10 Minuten ausliefert.
function ladeFrisch(speicher, datei) {
  return fetch(new Request(datei, { cache: 'reload' })).then((antwort) => {
    if (!antwort.ok) throw new Error(`${datei}: ${antwort.status}`);
    return speicher.put(datei, antwort);
  });
}

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(
    caches.open(SPEICHER)
      .then((speicher) => Promise.all(DATEIEN.map((datei) => ladeFrisch(speicher, datei))))
      .then(() => self.skipWaiting()),
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
