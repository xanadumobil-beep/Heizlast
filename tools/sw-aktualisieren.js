// Schreibt Dateiliste und Version in sw.js. Nach jeder Änderung an App-Dateien ausführen: npm run sw
import { readFile, writeFile } from 'node:fs/promises';
import { dateiListe, versionAusInhalt } from './sw-liste.js';

const ziel = new URL('../sw.js', import.meta.url);
const liste = await dateiListe();
const version = await versionAusInhalt(liste);
const block = `// --- erzeugt von tools/sw-aktualisieren.js, nicht von Hand ändern ---\nconst VERSION = '${version}';\nconst DATEIEN = ${JSON.stringify(['./', ...liste], null, 2)};\n// --- Ende des erzeugten Teils ---`;
const alt = await readFile(ziel, 'utf8');
const neu = alt.replace(/\/\/ --- erzeugt von[\s\S]*?\/\/ --- Ende des erzeugten Teils ---/, block);
await writeFile(ziel, neu);
console.log(`sw.js aktualisiert: Version ${version}, ${liste.length + 1} Dateien`);
