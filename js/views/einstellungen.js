// Rechenannahmen (Projekt-Einstellungen für die Berechnung) und App (Version, App-Speicher, dauerhafter Speicher).

import * as db from '../db.js';
import { el, ersetzeKinder, baueFormular } from '../ui.js';
import { fordereDauerhaftenSpeicherAn, speicherStatus } from '../persist.js';
import { hatFehler, hatWarnungen, validiereEinstellungen } from '../validate.js';
import { EINSTELLUNGEN_FELDER } from '../schemas.js';
import { schwellen } from '../geraete.js';
import { bytesText } from '../foto.js';
import { installierteVersion, onlineVersion, sucheUpdate, leereAppSpeicher, datumUhrzeit } from '../appversion.js';

function groesse(bytes) {
  if (bytes === null) return '–';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function baueSpeicherBlock() {
  const block = el('section', { class: 'karte speicher', 'data-lesen': true });
  const fuelle = async () => {
    const status = await speicherStatus();
    const fotos = await db.fotoSpeicher();
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
      status.belegt !== null ? el('p', { class: 'zeile' }, `Belegt: ${groesse(status.belegt)} von ${groesse(status.kontingent)} (Kontingent, soweit der Browser es meldet)`) : el('p', { class: 'zeile' }, 'Der Browser meldet keine Angaben zum Speicherplatz.'),
      el('p', { class: 'zeile' }, `Fotos und Baupläne: ${bytesText(fotos.bytes)} (${fotos.fotos} Foto${fotos.fotos === 1 ? '' : 's'}, ${fotos.hintergruende} Bauplan/Baupläne)`),
      status.unterstuetzt && !status.gewaehrt
        ? el('button', { type: 'button', onClick: async () => { await fordereDauerhaftenSpeicherAn(); await fuelle(); } }, 'Erneut anfordern')
        : null,
    );
  };
  await fuelle();
  return block;
}

// Zeigt, welche Version der App auf dem Gerät liegt und was online verfügbar ist.
async function baueVersionBlock() {
  const block = el('section', { class: 'karte', 'data-lesen': true });
  const meldung = el('p', { class: 'zeile', 'aria-live': 'polite' });
  const fuelle = async () => {
    const installiert = await installierteVersion().catch(() => null);
    let online = null;
    try { online = await onlineVersion(); } catch { /* offline */ }
    const aktuell = installiert && online?.version ? installiert === online.version : null;
    ersetzeKinder(
      block,
      el('h3', {}, 'App-Version'),
      el('p', { class: 'zeile' }, `Auf diesem Gerät: ${installiert ?? 'nicht zwischengespeichert'}`),
      el('p', { class: 'zeile' }, online
        ? `Online verfügbar: ${online.version ?? '?'}${online.erstellt ? ` (Stand ${datumUhrzeit(online.erstellt)})` : ''}`
        : 'Online verfügbar: nicht erreichbar (kein Internet?)'),
      aktuell === null ? null : el('p', { class: aktuell ? 'ok' : 'zeile' }, aktuell ? '✓ Die App ist auf dem neuesten Stand.' : 'Es gibt eine neuere Version. „Nach Updates suchen“ lädt sie.'),
      el(
        'div', { class: 'knopfzeile' },
        el('button', {
          type: 'button',
          onClick: async () => {
            meldung.textContent = 'Suche läuft …';
            try {
              const ergebnis = await sucheUpdate();
              meldung.textContent = ergebnis === 'neu'
                ? 'Eine neue Version wird geladen. Gleich erscheint oben der Hinweis zum Neuladen.'
                : ergebnis === 'aktuell' ? 'Keine neuere Version gefunden.' : 'Der Offline-Speicher ist in diesem Browser nicht aktiv.';
            } catch {
              meldung.textContent = 'Die Suche ist fehlgeschlagen. Bitte Internetverbindung prüfen.';
            }
            setTimeout(fuelle, 4000);
          },
        }, 'Nach Updates suchen'),
        el('button', {
          type: 'button',
          class: 'gefahr',
          onClick: async () => {
            if (!confirm('Nur die Programmdateien der App werden gelöscht und neu geladen. Deine Projektdaten (Räume, Flächen, Heizkörper, Verbrauch, Einstellungen, Plan-Positionen) werden NICHT angefasst. Es ist Internet nötig. Fortfahren?')) return;
            await leereAppSpeicher();
          },
        }, 'App-Speicher leeren und neu laden'),
      ),
      meldung,
      el('p', { class: 'hinweis' }, 'Hängt die App an einer alten Version, hilft „App-Speicher leeren und neu laden“. Es löscht nur die zwischengespeicherten Programmdateien (den Offline-Speicher der App) und lädt sie neu. Die Datenbank mit deinen Projektdaten wird dabei nicht berührt.'),
    );
  };
  await fuelle();
  return block;
}

export async function renderRechenannahmen(container) {
  const einstellungen = await db.ladeEinstellungen();
  const rueckmeldung = el('p', { class: 'ok', 'aria-live': 'polite' });
  let bestaetigt = false;

  const speichernKnopf = el('button', { type: 'button', class: 'primaer' }, 'Speichern');
  const formular = baueFormular(EINSTELLUNGEN_FELDER, { ...einstellungen, geraetepruefung: schwellen(einstellungen) }, () => {
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
    el('div', { class: 'kopf' }, el('h2', {}, 'Rechenannahmen')),
    el('p', { class: 'beschreibung' }, 'Projektname und alle Annahmen, die die Berechnung beeinflussen. Zahlen mit Komma eingeben, zum Beispiel 0,15.'),
    formular.element,
    el('div', { class: 'knopfzeile' }, speichernKnopf, rueckmeldung),
  );
}

export async function renderApp(container) {
  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'App')),
    el('p', { class: 'beschreibung' }, 'Version und Updates der App, Offline-Speicher und dauerhafter Speicher des Browsers.'),
    await baueVersionBlock(),
    await baueSpeicherBlock(),
  );
}
