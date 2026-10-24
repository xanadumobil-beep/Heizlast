// Lädt den gesamten Projektstand aus der Datenbank und rechnet ihn durch.

import * as db from './db.js';
import { baueRechenEingabe, baueHeizkoerperEingabe, migriereVerbrauch } from './modell.js';
import { berechneGebaeude } from './engine/heatload.js';
import { bewerteRaeume } from './engine/vorlauf.js';
import { normalisiereSzenario, wendeSzenarioAn } from './szenario.js';

// Alle Szenarien, nach Name sortiert.
export async function ladeSzenarien() {
  return (await db.alle('scenarios')).map(normalisiereSzenario).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// Das aktive Szenario (oder null) und der Schreibschutz der Bestandsdaten. Ein Szenario, das es nicht mehr gibt
// (zum Beispiel nach einem Import), gilt als nicht aktiv. Wird vor jeder Ansicht aufgerufen.
export async function ladeAktivesSzenario() {
  const id = await db.ladeAktivesSzenarioId();
  const szenario = id ? (await ladeSzenarien()).find((s) => s.id === id) ?? null : null;
  db.setzeSchreibschutz(Boolean(szenario));
  return szenario;
}

// Wechselt das aktive Szenario (null = Ist-Zustand), setzt den Schreibschutz und meldet es den Ansichten.
export async function setzeAktivesSzenario(id) {
  await db.speichereAktivesSzenarioId(id);
  await ladeAktivesSzenario();
  globalThis.dispatchEvent?.(new Event('szenario-geaendert'));
}

// Projekt im Ist-Zustand, unabhängig vom aktiven Szenario.
export async function ladeIstProjekt() {
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

// Projekt, wie es die Ansichten zeigen: mit dem aktiven Szenario, falls eines aktiv ist, sonst der Ist-Zustand.
// Zusätzliche Felder: szenario ({ id, name } oder null), szenarioHinweise (Abweichungen ohne Ziel) und ist (Ist-Zustand).
export async function ladeProjekt() {
  const ist = await ladeIstProjekt();
  const szenario = await ladeAktivesSzenario();
  if (!szenario) return { ...ist, szenario: null, szenarioHinweise: [], ist };
  const { projekt, hinweise } = wendeSzenarioAn(ist, szenario);
  return { ...projekt, szenario: { id: szenario.id, name: szenario.name }, szenarioHinweise: hinweise, ist };
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
