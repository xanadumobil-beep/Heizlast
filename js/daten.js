// Lädt den gesamten Projektstand aus der Datenbank und rechnet ihn durch.

import * as db from './db.js';
import { baueRechenEingabe } from './modell.js';
import { berechneGebaeude } from './engine/heatload.js';

export async function ladeProjekt() {
  const [einstellungen, zonen, bauteile, oeffnungstypen, raeume, flaechen] = await Promise.all([
    db.ladeEinstellungen(), db.alle('zones'), db.alle('components'), db.alle('openingTypes'),
    db.alle('rooms'), db.alle('surfaces'),
  ]);
  const nachName = (a, b) => a.name.localeCompare(b.name, 'de');
  return {
    einstellungen,
    zonen: zonen.sort(nachName),
    bauteile: bauteile.sort(nachName),
    oeffnungstypen: oeffnungstypen.sort(nachName),
    raeume: raeume.sort(nachName),
    flaechen,
  };
}

// Rechnet das Projekt. Rückgabe: { ergebnis, hinweise, fehler }. Bei einem Rechenfehler
// (z. B. unbekannte Zone) steht der Text in "fehler" und das Ergebnis fehlt.
export function rechne(projekt) {
  const { eingabe, hinweise } = baueRechenEingabe(projekt);
  try {
    return { ergebnis: berechneGebaeude(eingabe), hinweise, fehler: null };
  } catch (fehler) {
    return { ergebnis: null, hinweise, fehler: fehler.message };
  }
}
