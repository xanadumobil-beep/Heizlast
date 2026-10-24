// Start und Navigation. Die Bereiche selbst stehen in js/views/.

import * as db from './db.js';
import { ladeSzenarien, ladeAktivesSzenario, setzeAktivesSzenario, ladeIstProjekt } from './daten.js';
import { wendeSzenarioAn } from './szenario.js';
import { fordereIstZustand, macheSchreibgeschuetzt } from './schutz.js';
import { renderSzenarien } from './views/szenarien.js';
import { el } from './ui.js';
import { fordereDauerhaftenSpeicherAn } from './persist.js';
import { renderEinstellungen } from './views/einstellungen.js';
import { renderKatalog, KATALOGE } from './views/katalog.js';
import { renderRaeume, renderRaum } from './views/raeume.js';
import { renderVorlauf } from './views/vorlauf.js';
import { renderVerbrauch, renderVerbrauchListe } from './views/verbrauch.js';
import { renderSicherung } from './views/sicherung.js';
import { renderBericht } from './views/bericht.js';
import { renderPlan } from './views/plan.js';
import { aktualisiereBanner } from './banner.js';

// render(container, neuLaden, parameter): parameter ist der Teil nach dem Schrägstrich im Link.
const TABS = [
  { id: 'raeume', titel: 'Räume', render: (c, neu, id) => (id ? renderRaum(c, id, neu) : renderRaeume(c, neu)) },
  { id: 'plan', titel: 'Plan', render: (c) => renderPlan(c) },
  { id: 'vorlauf', titel: 'Vorlauf', render: (c) => renderVorlauf(c) },
  { id: 'verbrauch', titel: 'Verbrauch', render: (c, neu, id) => (id ? renderVerbrauch(c, id, neu) : renderVerbrauchListe(c, neu)) },
  { id: 'szenarien', titel: 'Szenarien', render: (c, neu, id) => renderSzenarien(c, id, neu) },
  { id: 'bericht', titel: 'Bericht', render: (c) => renderBericht(c) },
  { id: 'bauteile', titel: 'Bauteile', render: (c, neu) => renderKatalog(c, KATALOGE.bauteile, neu) },
  { id: 'oeffnungen', titel: 'Öffnungen', render: (c, neu) => renderKatalog(c, KATALOGE.oeffnungen, neu) },
  { id: 'zonen', titel: 'Zonen', render: (c, neu) => renderKatalog(c, KATALOGE.zonen, neu) },
  { id: 'sicherung', titel: 'Sicherung', render: (c, neu) => renderSicherung(c, neu) },
  { id: 'einstellungen', titel: 'Einstellungen', render: (c) => renderEinstellungen(c) },
];

// Ansichten, in denen die Bestandsdaten bearbeitet werden. Im Szenario-Betrieb sind sie schreibgeschützt.
const SCHREIBGESCHUETZTE_TABS = new Set(['raeume', 'verbrauch', 'bauteile', 'oeffnungen', 'zonen', 'einstellungen', 'sicherung']);

const inhalt = document.getElementById('inhalt');
const navigation = document.getElementById('navigation');
let zeichnung = 0;

// Links: #raeume, #raum/<id>, #vorlauf, #verbrauch, #verbrauch/<id|neu>, #bericht, #bauteile, #oeffnungen, #zonen, #sicherung, #einstellungen
function aktuelleRoute() {
  const [erster, parameter] = location.hash.slice(1).split('/');
  const tabId = erster === 'raum' ? 'raeume' : erster;
  return { tab: TABS.find((t) => t.id === tabId) ?? TABS[0], parameter };
}

// Szenario-Auswahl oben und farbiger Streifen, solange ein Szenario aktiv ist.
async function aktualisiereSzenarioLeiste() {
  const szenarien = await ladeSzenarien();
  const aktiv = await ladeAktivesSzenario();
  const wahl = document.getElementById('szenarioWahl');
  wahl.replaceChildren(
    el('option', { value: '' }, 'Ist-Zustand'),
    ...szenarien.map((sz) => el('option', { value: sz.id }, `Szenario: ${sz.name}`)),
  );
  wahl.value = aktiv?.id ?? '';
  document.body.classList.toggle('szenario-aktiv', Boolean(aktiv));

  const streifen = document.getElementById('szenarioStreifen');
  if (!aktiv) {
    streifen.hidden = true;
    streifen.replaceChildren();
    return aktiv;
  }
  const { hinweise } = wendeSzenarioAn(await ladeIstProjekt(), aktiv);
  streifen.replaceChildren(
    el(
      'p', {},
      el('strong', {}, `Szenario: ${aktiv.name} aktiv`),
      ' Alle Werte in Räumen, Plan, Vorlauf und Bericht gelten für dieses Szenario. Die Bestandsdaten sind schreibgeschützt.',
      hinweise.length > 0 ? el('span', { class: 'streifen-hinweis' }, ` ⚠ ${hinweise.length} Abweichung${hinweise.length === 1 ? '' : 'en'} ohne Ziel im Ist-Zustand, siehe Szenario-Editor.`) : null,
    ),
    el('div', { class: 'knopfzeile' },
      el('a', { class: 'knopf', href: `#szenarien/${aktiv.id}` }, 'Szenario bearbeiten'),
      el('button', { type: 'button', onClick: () => setzeAktivesSzenario(null) }, 'Zum Ist-Zustand')),
  );
  streifen.hidden = false;
  return aktiv;
}

async function zeigeTab() {
  const { tab, parameter } = aktuelleRoute();
  const aktivesSzenario = await aktualisiereSzenarioLeiste();
  for (const link of navigation.querySelectorAll('a')) {
    link.toggleAttribute('aria-current', link.dataset.tab === tab.id);
  }
  aktualisiereBanner();
  const lauf = ++zeichnung;
  const neuerInhalt = el('div');
  await tab.render(neuerInhalt, zeigeTab, parameter);
  if (aktivesSzenario && SCHREIBGESCHUETZTE_TABS.has(tab.id)) macheSchreibgeschuetzt(neuerInhalt);
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
  document.getElementById('szenarioWahl').addEventListener('change', (e) => setzeAktivesSzenario(e.target.value || null));
  window.addEventListener('szenario-geaendert', zeigeTab);
  // Sicherheitsnetz: ein Schreibversuch auf Bestandsdaten im Szenario-Betrieb fragt nach dem Wechsel zum Ist-Zustand.
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason instanceof db.SchreibschutzFehler) {
      e.preventDefault();
      fordereIstZustand();
    }
  });
  window.addEventListener('hashchange', zeigeTab);
  await zeigeTab();
}

// Offline-Betrieb: Service Worker anmelden. Kommt eine neue Version, bietet die App das Neuladen an.
function registriereServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hatteSteuerung = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteSteuerung) return;
    const hinweis = document.getElementById('update');
    hinweis.replaceChildren(
      el('p', {}, 'Eine neue Version der App ist bereit.'),
      el('button', { type: 'button', onClick: () => location.reload() }, 'Jetzt neu laden'),
    );
    hinweis.hidden = false;
  });
  navigator.serviceWorker.register('sw.js').then((registrierung) => {
    // Eine Home-Bildschirm-App sucht von selbst nur beim Start nach Updates. Deshalb zusätzlich beim Zurückkehren
    // in den Vordergrund und regelmäßig, solange sie offen ist.
    const suche = () => registrierung.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') suche(); });
    setInterval(suche, 30 * 60 * 1000);
  }).catch(() => { /* ohne Service Worker läuft die App online weiter */ });
}

registriereServiceWorker();
start();
