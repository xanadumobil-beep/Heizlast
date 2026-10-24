// Lädt den gesamten Projektstand aus der Datenbank und rechnet ihn durch.

import * as db from './db.js';
import { baueRechenEingabe, baueHeizkoerperEingabe, migriereVerbrauch } from './modell.js';
import { berechneGebaeude } from './engine/heatload.js';
import { bewerteRaeume } from './engine/vorlauf.js';

export async function ladeProjekt() {
  const [einstellungen, zonen, bauteile, oeffnungstypen, raeume, flaechen, heizkoerper, verbrauch] = await Promise.all([
    db.ladeEinstellungen(), db.alle('zones'), db.alle('components'), db.alle('openingTypes'),
    db.alle('rooms'), db.alle('surfaces'), db.alle('radiators'), db.alle('consumption'),
  ]);
  const nachName = (a, b) => a.name.localeCompare(b.name, 'de');
  return {
    einstellungen,
    zonen: zonen.sort(nachName),
    bauteile: bauteile.sort(nachName),
    oeffnungstypen: oeffnungstypen.sort(nachName),
    raeume: raeume.sort(nachName),
    flaechen,
    heizkoerper,
    verbrauch: verbrauch.map(migriereVerbrauch).sort(nachName),
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

// Bewertet die beheizten Räume mit ihren Heizkörpern bei einer Ziel-Vorlauftemperatur.
// Grundlage ist die ungünstige Heizlast, die günstige läuft daneben mit.
export function bewerteVorlauf(projekt, ergebnis, zielVorlauf) {
  return bewerteRaeume({
    raeume: ergebnis.raeume.filter((r) => r.status === 'beheizt'),
    heizkoerper: baueHeizkoerperEingabe(projekt.heizkoerper, projekt.einstellungen),
    spreizung: projekt.einstellungen.spreizung,
    zielVorlauf,
  });
}
