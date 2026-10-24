// Oberfläche zum Schreibschutz im Szenario-Betrieb. Die eigentliche Sperre sitzt in db.js.

import * as db from './db.js';
import { setzeAktivesSzenario } from './daten.js';

// Fragt, ob zum Ist-Zustand gewechselt werden soll. Gibt true zurück, wenn gewechselt wurde.
export async function fordereIstZustand() {
  if (!confirm('Ein Szenario ist aktiv, deshalb sind die Bestandsdaten schreibgeschützt. Änderungen gehören in den Ist-Zustand oder in den Szenario-Editor.\n\nJetzt zum Ist-Zustand wechseln?')) return false;
  await setzeAktivesSzenario(null);
  return true;
}

// Macht eine Ansicht schreibgeschützt: Eingabefelder und Knöpfe werden gesperrt. Ausgenommen ist alles mit data-lesen
// (zum Beispiel Export, Updatesuche) sowie Links und aufklappbare Bereiche.
export function macheSchreibgeschuetzt(wurzel) {
  if (!db.istSchreibgeschuetzt()) return;
  for (const feld of wurzel.querySelectorAll('input, select, textarea, button')) {
    if (feld.closest('[data-lesen]')) continue;
    feld.disabled = true;
  }
  wurzel.classList.add('schreibgeschuetzt');
}
