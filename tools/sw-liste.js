// Ermittelt die Dateien, die der Service Worker für den Offline-Betrieb zwischenspeichert,
// und eine Versionskennung aus deren Inhalt. Wird von sw-aktualisieren.js und vom Test genutzt.

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const WURZEL = new URL('..', import.meta.url).pathname;
const ORDNER = ['css', 'js', 'icons', 'examples'];
const EINZELN = ['index.html', 'manifest.webmanifest'];

async function dateienIn(ordner) {
  const eintraege = await readdir(join(WURZEL, ordner), { withFileTypes: true });
  const ergebnis = [];
  for (const e of eintraege) {
    const pfad = join(ordner, e.name);
    if (e.isDirectory()) ergebnis.push(...(await dateienIn(pfad)));
    else if (e.name !== 'icon.svg') ergebnis.push(pfad.split(sep).join('/'));
  }
  return ergebnis;
}

export async function dateiListe() {
  const liste = [...EINZELN];
  for (const ordner of ORDNER) liste.push(...(await dateienIn(ordner)));
  return liste.sort();
}

export async function versionAusInhalt(liste) {
  const hash = createHash('sha256');
  for (const datei of liste) {
    hash.update(datei);
    hash.update(await readFile(join(WURZEL, relative('.', datei))));
  }
  return hash.digest('hex').slice(0, 10);
}
