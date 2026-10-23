// Minimaler Test-Runner ohne Abhängigkeiten.
// Läuft in Node (tests/run.js) und im Browser (tests/tests.html) gleich.

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

// Prüft, ob zwei Zahlen bis auf die Toleranz gleich sind.
export function gleich(erhalten, erwartet, toleranz = 0.01, hinweis = '') {
  if (!(Math.abs(erhalten - erwartet) <= toleranz)) {
    throw new Error(`${hinweis} erwartet ${erwartet}, erhalten ${erhalten}`.trim());
  }
}

export function wahr(bedingung, hinweis = 'Bedingung nicht erfüllt') {
  if (!bedingung) throw new Error(hinweis);
}

export async function alleTestsAusfuehren() {
  const ergebnisse = [];
  for (const t of tests) {
    try {
      await t.fn();
      ergebnisse.push({ name: t.name, ok: true });
    } catch (fehler) {
      ergebnisse.push({ name: t.name, ok: false, fehler: fehler.message });
    }
  }
  return ergebnisse;
}
