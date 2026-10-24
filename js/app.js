// Start und Navigation. Die Bereiche selbst stehen in js/views/.

import * as db from './db.js';
import { el } from './ui.js';
import { fordereDauerhaftenSpeicherAn } from './persist.js';
import { renderEinstellungen } from './views/einstellungen.js';
import { renderKatalog, KATALOGE } from './views/katalog.js';
import { renderRaeume, renderRaum } from './views/raeume.js';
import { renderVorlauf } from './views/vorlauf.js';
import { renderVerbrauch, renderVerbrauchListe } from './views/verbrauch.js';
import { renderSicherung } from './views/sicherung.js';
import { aktualisiereBanner } from './banner.js';

// render(container, neuLaden, parameter): parameter ist der Teil nach dem Schrägstrich im Link.
const TABS = [
  { id: 'raeume', titel: 'Räume', render: (c, neu, id) => (id ? renderRaum(c, id, neu) : renderRaeume(c, neu)) },
  { id: 'vorlauf', titel: 'Vorlauf', render: (c) => renderVorlauf(c) },
  { id: 'verbrauch', titel: 'Verbrauch', render: (c, neu, id) => (id ? renderVerbrauch(c, id, neu) : renderVerbrauchListe(c, neu)) },
  { id: 'bauteile', titel: 'Bauteile', render: (c, neu) => renderKatalog(c, KATALOGE.bauteile, neu) },
  { id: 'oeffnungen', titel: 'Öffnungen', render: (c, neu) => renderKatalog(c, KATALOGE.oeffnungen, neu) },
  { id: 'zonen', titel: 'Zonen', render: (c, neu) => renderKatalog(c, KATALOGE.zonen, neu) },
  { id: 'sicherung', titel: 'Sicherung', render: (c, neu) => renderSicherung(c, neu) },
  { id: 'einstellungen', titel: 'Einstellungen', render: (c) => renderEinstellungen(c) },
];

const inhalt = document.getElementById('inhalt');
const navigation = document.getElementById('navigation');
let zeichnung = 0;

// Links: #raeume, #raum/<id>, #vorlauf, #verbrauch, #verbrauch/<id|neu>, #bauteile, #oeffnungen, #zonen, #sicherung, #einstellungen
function aktuelleRoute() {
  const [erster, parameter] = location.hash.slice(1).split('/');
  const tabId = erster === 'raum' ? 'raeume' : erster;
  return { tab: TABS.find((t) => t.id === tabId) ?? TABS[0], parameter };
}

async function zeigeTab() {
  const { tab, parameter } = aktuelleRoute();
  for (const link of navigation.querySelectorAll('a')) {
    link.toggleAttribute('aria-current', link.dataset.tab === tab.id);
  }
  aktualisiereBanner();
  const lauf = ++zeichnung;
  const neuerInhalt = el('div');
  await tab.render(neuerInhalt, zeigeTab, parameter);
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
