// Startet alle Tests in Node: npm test
import './engine.test.js';
import { alleTestsAusfuehren } from './runner.js';

const ergebnisse = await alleTestsAusfuehren();
let fehlgeschlagen = 0;
for (const e of ergebnisse) {
  if (e.ok) {
    console.log(`✔ ${e.name}`);
  } else {
    fehlgeschlagen += 1;
    console.log(`✘ ${e.name}\n    ${e.fehler}`);
  }
}
console.log(`\n${ergebnisse.length - fehlgeschlagen} von ${ergebnisse.length} Tests bestanden.`);
process.exitCode = fehlgeschlagen === 0 ? 0 : 1;
