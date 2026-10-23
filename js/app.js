// Oberfläche: Navigation, Einstellungen und die Kataloge (Zonen, Bauteile, Öffnungen).
// Rechenlogik steht in js/engine/, Datenhaltung in js/db.js, Prüfregeln in js/validate.js.

import * as db from './db.js';
import { el, baueFormular } from './ui.js';
import { fordereDauerhaftenSpeicherAn, speicherStatus } from './persist.js';
import {
  hatFehler, hatWarnungen, validiereEinstellungen, validiereZone, validiereBauteil, validiereOeffnungstyp,
} from './validate.js';
import {
  EINSTELLUNGEN_FELDER, ZONEN_FELDER, BAUTEIL_FELDER, OEFFNUNGS_FELDER,
  ZONENARTEN, BAUTEILARTEN, OEFFNUNGSARTEN, QUELLEN, werte,
  neueZone, neuesBauteil, neuerOeffnungstyp, zoneZeilen, bauteilZeilen, oeffnungsZeilen,
} from './schemas.js';

const KATALOGE = {
  zonen: {
    store: 'zones',
    titel: 'Zonen',
    objekt: 'Zone',
    beschreibung:
      'Angrenzende Bereiche mit einer Temperatur als Minimum und Maximum: Erdreich, unbeheizte Kellerräume, Nachbargebäude. '
      + 'Außenluft ist keine Zone, sie folgt der Normaußentemperatur in den Einstellungen.',
    felder: ZONEN_FELDER,
    neu: neueZone,
    validiere: (zone) => validiereZone(zone, werte(ZONENARTEN)),
    zeilen: zoneZeilen,
  },
  bauteile: {
    store: 'components',
    titel: 'Bauteile',
    objekt: 'Bauteil',
    beschreibung: 'Bauteilkatalog mit U-Wert als Minimum und Maximum. Die Raumflächen verweisen später auf diese Einträge.',
    felder: BAUTEIL_FELDER,
    neu: neuesBauteil,
    validiere: (bauteil) => validiereBauteil(bauteil, werte(BAUTEILARTEN), werte(QUELLEN)),
    zeilen: bauteilZeilen,
  },
  oeffnungen: {
    store: 'openingTypes',
    titel: 'Öffnungen',
    objekt: 'Öffnungstyp',
    beschreibung: 'Fenster- und Türtypen mit Uw-Wert. Die Öffnungen einer Raumfläche werden später von deren Fläche abgezogen.',
    felder: OEFFNUNGS_FELDER,
    neu: neuerOeffnungstyp,
    validiere: (typ) => validiereOeffnungstyp(typ, werte(OEFFNUNGSARTEN), werte(QUELLEN)),
    zeilen: oeffnungsZeilen,
  },
};

const TABS = [
  { id: 'einstellungen', titel: 'Einstellungen', render: renderEinstellungen },
  { id: 'zonen', titel: 'Zonen', render: (c) => renderKatalog(c, KATALOGE.zonen) },
  { id: 'bauteile', titel: 'Bauteile', render: (c) => renderKatalog(c, KATALOGE.bauteile) },
  { id: 'oeffnungen', titel: 'Öffnungen', render: (c) => renderKatalog(c, KATALOGE.oeffnungen) },
];

// --- Dialog zum Bearbeiten ---------------------------------------------------------

// Zeigt ein Formular im Dialog. Fehler verhindern das Speichern. Bei Warnungen
// erscheinen die Hinweise, und ein zweiter Klick ("Trotzdem speichern") speichert.
function oeffneDialog({ titel, felder, werteVorgabe, validiere, speichern }) {
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

// --- Kataloge ----------------------------------------------------------------------

async function renderKatalog(container, katalog) {
  const eintraege = (await db.alle(katalog.store)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const neuLaden = () => zeigeTab();

  const bearbeiten = (eintrag) => oeffneDialog({
    titel: `${katalog.objekt} ${eintrag.id ? 'bearbeiten' : 'anlegen'}`,
    felder: katalog.felder,
    werteVorgabe: eintrag,
    validiere: katalog.validiere,
    speichern: async (gelesen) => {
      await db.speichere(katalog.store, { ...gelesen, id: gelesen.id ?? db.neueId() });
      neuLaden();
    },
  });

  const karten = eintraege.map((eintrag) => {
    const meldungen = katalog.validiere(eintrag);
    const markiert = hatWarnungen(meldungen) || hatFehler(meldungen);
    return el(
      'article', { class: markiert ? 'karte markiert' : 'karte' },
      el('h3', {}, eintrag.name, markiert ? el('span', { class: 'marke' }, '⚠ prüfen') : null),
      katalog.zeilen(eintrag).filter(Boolean).map((zeile) => el('p', { class: 'zeile' }, zeile)),
      meldungen.map((m) => el('p', { class: `meldung ${m.stufe}` }, `⚠ ${m.text}`)),
      el(
        'div', { class: 'knopfzeile' },
        el('button', { type: 'button', onClick: () => bearbeiten(eintrag) }, 'Bearbeiten'),
        el('button', {
          type: 'button',
          onClick: () => bearbeiten({ ...eintrag, id: undefined, name: `${eintrag.name} (Kopie)` }),
        }, 'Kopieren'),
        el('button', {
          type: 'button',
          class: 'gefahr',
          onClick: async () => {
            if (!confirm(`${katalog.objekt} „${eintrag.name}“ löschen?`)) return;
            await db.loesche(katalog.store, eintrag.id);
            neuLaden();
          },
        }, 'Löschen'),
      ),
    );
  });

  container.replaceChildren(
    el('div', { class: 'kopf' }, el('h2', {}, katalog.titel), el('button', { type: 'button', class: 'primaer', onClick: () => bearbeiten(katalog.neu()) }, `+ ${katalog.objekt}`)),
    el('p', { class: 'beschreibung' }, katalog.beschreibung),
    karten.length > 0
      ? el('div', { class: 'karten' }, karten)
      : el('p', { class: 'leer' }, `Noch keine Einträge. Mit „+ ${katalog.objekt}“ legst du den ersten an.`),
  );
}

// --- Einstellungen -----------------------------------------------------------------

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
    block.replaceChildren(
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

async function renderEinstellungen(container) {
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

  container.replaceChildren(
    el('div', { class: 'kopf' }, el('h2', {}, 'Einstellungen')),
    el('p', { class: 'beschreibung' }, 'Projektweite Annahmen für die Berechnung. Zahlen mit Komma eingeben, zum Beispiel 0,15.'),
    formular.element,
    el('div', { class: 'knopfzeile' }, speichernKnopf, rueckmeldung),
    await baueSpeicherBlock(),
  );
}

// --- Navigation und Start ----------------------------------------------------------

const inhalt = document.getElementById('inhalt');
const navigation = document.getElementById('navigation');
let zeichnung = 0;

async function zeigeTab() {
  const tab = TABS.find((t) => t.id === location.hash.slice(1)) ?? TABS[0];
  for (const link of navigation.querySelectorAll('a')) {
    link.toggleAttribute('aria-current', link.dataset.tab === tab.id);
  }
  const lauf = ++zeichnung;
  const neuerInhalt = el('div');
  await tab.render(neuerInhalt);
  if (lauf === zeichnung) inhalt.replaceChildren(neuerInhalt);
}

function baueNavigation() {
  navigation.replaceChildren(...TABS.map((t) => el('a', { href: `#${t.id}`, 'data-tab': t.id }, t.titel)));
}

async function start() {
  try {
    await db.oeffneDb();
    await db.stelleStandardsSicher();
  } catch (fehler) {
    inhalt.replaceChildren(
      el('p', { class: 'meldung fehler' }, `Der lokale Speicher ist nicht verfügbar: ${fehler.message}. `
        + 'Im privaten Modus von Safari funktioniert die Datenbank nicht dauerhaft.'),
    );
    return;
  }
  fordereDauerhaftenSpeicherAn();
  baueNavigation();
  window.addEventListener('hashchange', zeigeTab);
  await zeigeTab();
}

start();
