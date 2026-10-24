// Dialog zum Bearbeiten mit Formular, Prüfung und zweistufigem Speichern bei Warnungen.

import { el, baueFormular } from './ui.js';
import { hatFehler, hatWarnungen } from './validate.js';
import { istSchreibgeschuetzt } from './db.js';
import { fordereIstZustand } from './schutz.js';

// Zeigt ein Formular im Dialog. Fehler verhindern das Speichern. Bei Warnungen
// erscheinen die Hinweise, und ein zweiter Klick ("Trotzdem speichern") speichert.
// speichern(gelesen) bekommt die Werte der Vorgabe, überlagert mit den Eingaben.
// ausnahmeSchutz: nur für den Szenario-Editor, der keine Bestandsdaten schreibt.
export function oeffneDialog({ titel, felder, werteVorgabe, validiere, speichern, ausnahmeSchutz = false }) {
  if (istSchreibgeschuetzt() && !ausnahmeSchutz) {
    fordereIstZustand();
    return;
  }
  const dialog = el('dialog', { class: 'bearbeiten' });
  let bestaetigt = false;

  const speichernKnopf = el('button', { type: 'button', class: 'primaer' }, 'Speichern');
  const formular = baueFormular(felder, werteVorgabe, () => {
    bestaetigt = false;
    speichernKnopf.textContent = 'Speichern';
  });

  speichernKnopf.addEventListener('click', async () => {
    const gelesen = { ...werteVorgabe, ...formular.lies() };
    const meldungen = validiere(gelesen);
    formular.zeigeMeldungen(meldungen);
    if (hatFehler(meldungen)) return;
    if (hatWarnungen(meldungen) && !bestaetigt) {
      bestaetigt = true;
      speichernKnopf.textContent = 'Trotzdem speichern';
      return;
    }
    await speichern(gelesen);
    dialog.close();
  });

  dialog.append(
    el('h2', {}, titel),
    formular.element,
    el(
      'div', { class: 'knopfzeile' },
      el('button', { type: 'button', onClick: () => dialog.close() }, 'Abbrechen'),
      speichernKnopf,
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
