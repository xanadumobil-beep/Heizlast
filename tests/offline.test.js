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

  test('Offline: Manifest verweist auf vorhandene Icons, index.html bindet Manifest ein', async () => {
    const { readFile, access } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
    wahr(manifest.display === 'standalone' && manifest.start_url === './', 'standalone mit relativer Startadresse');
    for (const icon of manifest.icons) await access(new URL(`../${icon.src}`, import.meta.url));
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    wahr(html.includes('rel="manifest"') && html.includes('apple-touch-icon'), 'Manifest und Apple-Icon verlinkt');
  });
}
