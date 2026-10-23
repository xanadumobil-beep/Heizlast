// Projekt-Einstellungen und Status des dauerhaften Speichers.

import * as db from '../db.js';
import { el, ersetzeKinder, baueFormular } from '../ui.js';
import { fordereDauerhaftenSpeicherAn, speicherStatus } from '../persist.js';
import { hatFehler, hatWarnungen, validiereEinstellungen } from '../validate.js';
import { EINSTELLUNGEN_FELDER } from '../schemas.js';

function groesse(bytes) {
  if (bytes === null) return '–';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function baueSpeicherBlock() {
  const block = el('section', { class: 'karte speicher' });
  const fuelle = async () => {
    const status = await speicherStatus();
    let text;
    if (!status.unterstuetzt) {
      text = 'Dieser Browser unterstützt dauerhaften Speicher nicht. Bitte regelmäßig eine Sicherungsdatei exportieren.';
    } else if (status.gewaehrt) {
      text = '✓ Gewährt: der Browser löscht die Daten nicht von selbst.';
    } else {
      text = 'Nicht gewährt: Safari kann lokale Daten nach längerer Nichtnutzung löschen. Bitte regelmäßig eine Sicherungsdatei exportieren.';
    }
    ersetzeKinder(block, 
      el('h3', {}, 'Dauerhafter Speicher'),
      el('p', { class: status.gewaehrt ? 'ok' : 'zeile' }, text),
      status.belegt !== null ? el('p', { class: 'zeile' }, `Belegt: ${groesse(status.belegt)} von ${groesse(status.kontingent)}`) : null,
      status.unterstuetzt && !status.gewaehrt
        ? el('button', { type: 'button', onClick: async () => { await fordereDauerhaftenSpeicherAn(); await fuelle(); } }, 'Erneut anfordern')
        : null,
    );
  };
  await fuelle();
  return block;
}

export async function renderEinstellungen(container) {
  const einstellungen = await db.ladeEinstellungen();
  const rueckmeldung = el('p', { class: 'ok', 'aria-live': 'polite' });
  let bestaetigt = false;

  const speichernKnopf = el('button', { type: 'button', class: 'primaer' }, 'Speichern');
  const formular = baueFormular(EINSTELLUNGEN_FELDER, einstellungen, () => {
    bestaetigt = false;
    speichernKnopf.textContent = 'Speichern';
    rueckmeldung.textContent = '';
  });

  speichernKnopf.addEventListener('click', async () => {
    const gelesen = { ...einstellungen, ...formular.lies() };
    const meldungen = validiereEinstellungen(gelesen);
    formular.zeigeMeldungen(meldungen);
    if (hatFehler(meldungen)) return;
    if (hatWarnungen(meldungen) && !bestaetigt) {
      bestaetigt = true;
      speichernKnopf.textContent = 'Trotzdem speichern';
      return;
    }
    await db.speichere('settings', gelesen);
    bestaetigt = false;
    speichernKnopf.textContent = 'Speichern';
    rueckmeldung.textContent = 'Gespeichert.';
  });

  ersetzeKinder(container, 
    el('div', { class: 'kopf' }, el('h2', {}, 'Einstellungen')),
    el('p', { class: 'beschreibung' }, 'Projektweite Annahmen für die Berechnung. Zahlen mit Komma eingeben, zum Beispiel 0,15.'),
    formular.element,
    el('div', { class: 'knopfzeile' }, speichernKnopf, rueckmeldung),
    await baueSpeicherBlock(),
  );
}
