// Prüft, dass der Service Worker alle App-Dateien kennt und seine Version zum Inhalt passt.
// Schlägt der Test fehl: npm run sw ausführen.

import { test, wahr } from './runner.js';

const imNode = typeof process !== 'undefined' && Boolean(process.versions?.node);

if (imNode) {
  test('Offline: sw.js enthält alle App-Dateien und die aktuelle Version', async () => {
    const { readFile } = await import('node:fs/promises');
    const { dateiListe, versionAusInhalt } = await import('../tools/sw-liste.js');
    const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    const liste = await dateiListe();
    const version = await versionAusInhalt(liste);
    wahr(sw.includes(`const VERSION = '${version}';`), 'Version in sw.js ist veraltet: npm run sw ausführen');
    for (const datei of liste) wahr(sw.includes(`"${datei}"`), `${datei} fehlt in der Dateiliste von sw.js: npm run sw ausführen`);
    wahr(liste.some((d) => d.startsWith('js/views/')) && liste.includes('css/print.css') && liste.includes('icons/icon-512.png'), 'Liste enthält Ansichten, Druck-CSS und Icons');
  });

  test('App-Speicher leeren: löscht nur „heizlast-…“-Caches und die Service-Worker-Anmeldung, nie die Datenbank', async () => {
    const { leereAppSpeicher } = await import('../js/appversion.js');
    const gemerkt = {};
    for (const name of ['caches', 'navigator', 'location', 'indexedDB']) gemerkt[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    const gesetzt = (name, wert) => Object.defineProperty(globalThis, name, { value: wert, configurable: true, writable: true });
    const geloescht = [];
    const abgemeldet = [];
    let neugeladen = false;
    let datenbankZugriff = false;
    gesetzt('caches', {
      keys: async () => ['heizlast-abc123', 'fremd-cache', 'heizlast-alt'],
      delete: async (n) => { geloescht.push(n); return true; },
    });
    gesetzt('navigator', { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { abgemeldet.push('sw'); } }] } });
    gesetzt('location', { reload: () => { neugeladen = true; } });
    // Jeder Zugriff auf indexedDB (open, deleteDatabase, databases …) würde diesen Test fehlschlagen lassen.
    gesetzt('indexedDB', new Proxy({}, { get: () => { datenbankZugriff = true; throw new Error('indexedDB berührt'); } }));
    try {
      await leereAppSpeicher();
    } finally {
      for (const [name, d] of Object.entries(gemerkt)) {
        if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name];
      }
    }
    wahr(geloescht.join() === 'heizlast-abc123,heizlast-alt', `gelöscht: ${geloescht}`);
    wahr(abgemeldet.length === 1 && neugeladen, 'Service Worker abgemeldet, Seite neu geladen');
    wahr(datenbankZugriff === false, 'kein Zugriff auf indexedDB');
  });

  test('Offline: Manifest verweist auf vorhandene Icons, index.html bindet Manifest ein', async () => {
    const { readFile, access } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
    wahr(manifest.display === 'standalone' && manifest.start_url === './', 'standalone mit relativer Startadresse');
    for (const icon of manifest.icons) await access(new URL(`../${icon.src}`, import.meta.url));
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    wahr(html.includes('rel="manifest"') && html.includes('apple-touch-icon'), 'Manifest und Apple-Icon verlinkt');
  });
}
