// Start und Navigation. Die Bereiche selbst stehen in js/views/.

import * as db from './db.js';
import { ladeSzenarien, ladeAktivesSzenario, setzeAktivesSzenario, ladeIstProjekt } from './daten.js';
import { wendeSzenarioAn } from './szenario.js';
import { fordereIstZustand, macheSchreibgeschuetzt } from './schutz.js';
import { renderSzenarien } from './views/szenarien.js';
import { el } from './ui.js';
import { fordereDauerhaftenSpeicherAn } from './persist.js';
import { renderRechenannahmen, renderApp } from './views/einstellungen.js';
import { renderKatalog, KATALOGE } from './views/katalog.js';
import { renderRaeume, renderRaum } from './views/raeume.js';
import { renderVorlauf } from './views/vorlauf.js';
import { renderVerbrauch, renderVerbrauchListe } from './views/verbrauch.js';
import { renderSicherung } from './views/sicherung.js';
import { renderBericht } from './views/bericht.js';
import { renderPlan } from './views/plan.js';
import { renderErgebnis } from './views/ergebnis.js';
import { renderWaermepumpen } from './views/waermepumpen.js';
import { renderFoto } from './views/fotos.js';
import { aktualisiereBanner } from './banner.js';
import { BEREICHE, SEITEN, seitenVon, merkeSeite, zielSeite, seiteAusLink } from './navigation.js';

// Darstellung je Seite. render(container, neuLaden, parameter, extra): parameter ist der Teil nach dem Schrägstrich im Link.
// Aufbau von Hauptband und Unterreitern: js/navigation.js.
const RENDER = {
  ergebnis: (c, neu) => renderErgebnis(c, neu),
  raeume: (c, neu, id) => (id ? renderRaum(c, id, neu) : renderRaeume(c, neu)),
  plan: (c) => renderPlan(c),
  vorlauf: (c) => renderVorlauf(c),
  szenarien: (c, neu, id) => renderSzenarien(c, id, neu),
  verbrauch: (c, neu, id) => (id ? renderVerbrauch(c, id, neu) : renderVerbrauchListe(c, neu)),
  bericht: (c) => renderBericht(c),
  bauteile: (c, neu) => renderKatalog(c, KATALOGE.bauteile, neu),
  oeffnungen: (c, neu) => renderKatalog(c, KATALOGE.oeffnungen, neu),
  zonen: (c, neu) => renderKatalog(c, KATALOGE.zonen, neu),
  waermepumpen: (c, neu) => renderWaermepumpen(c, neu),
  rechenannahmen: (c) => renderRechenannahmen(c),
  sicherung: (c, neu) => renderSicherung(c, neu),
  app: (c) => renderApp(c),
  foto: (c, neu, id, markierung) => renderFoto(c, id, markierung),
};
const TABS = SEITEN.map((s) => ({ ...s, render: RENDER[s.id] }));

// Ansichten, in denen die Bestandsdaten bearbeitet werden. Im Szenario-Betrieb sind sie schreibgeschützt.
const SCHREIBGESCHUETZTE_TABS = new Set(['raeume', 'verbrauch', 'bauteile', 'oeffnungen', 'zonen', 'rechenannahmen', 'sicherung']);

// Zuletzt geöffnete Seiten merkt sich der Browser nur als Bequemlichkeit.
const merkspeicher = (() => { try { return globalThis.localStorage; } catch { return null; } })();

const inhalt = document.getElementById('inhalt');
const navigation = document.getElementById('navigation');
const unterreiter = document.getElementById('unterreiter');
let zeichnung = 0;

// Links: #ergebnis, #raeume, #raum/<id>, #plan, #vorlauf, #szenarien, #verbrauch, #verbrauch/<id|neu>, #bericht, #bauteile, #oeffnungen, #zonen, #rechenannahmen, #sicherung, #app
function aktuelleRoute() {
  const { seite, parameter, extra } = seiteAusLink(location.hash, merkspeicher);
  return { tab: TABS.find((t) => t.id === seite.id), parameter, extra };
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
  const { tab, parameter, extra } = aktuelleRoute();
  const aktivesSzenario = await aktualisiereSzenarioLeiste();
  merkeSeite(merkspeicher, tab);
  baueNavigation(tab);
  aktualisiereBanner();
  const lauf = ++zeichnung;
  const neuerInhalt = el('div');
  await tab.render(neuerInhalt, zeigeTab, parameter, extra);
  if (aktivesSzenario && SCHREIBGESCHUETZTE_TABS.has(tab.id)) macheSchreibgeschuetzt(neuerInhalt);
  if (lauf === zeichnung) inhalt.replaceChildren(neuerInhalt);
}

// Hauptband und Unterreiter. Der Hauptpunkt führt zur zuletzt dort geöffneten Seite, der Unterreiter zeigt die Seiten des gewählten Bereichs.
function baueNavigation(aktuell) {
  navigation.replaceChildren(...BEREICHE.map((b) => el(
    'a', {
      href: `#${zielSeite(merkspeicher, b.id)}`, 'data-bereich': b.id, 'aria-label': b.beschriftung ?? b.titel, title: b.beschriftung ?? b.titel,
      'aria-current': b.id === aktuell.bereich ? 'page' : undefined,
    },
    el('span', { class: 'nav-symbol', 'aria-hidden': 'true' }, b.symbol),
    el('span', { class: 'nav-lang', 'aria-hidden': 'true' }, b.titel),
    el('span', { class: 'nav-kurz', 'aria-hidden': 'true' }, b.kurz),
  )));
  const seiten = seitenVon(aktuell.bereich);
  unterreiter.hidden = seiten.length < 2;
  unterreiter.replaceChildren(...(seiten.length < 2 ? [] : seiten.map((t) => el(
    'a', { href: `#${t.id}`, 'data-tab': t.id, 'aria-current': t.id === (aktuell.nav ?? aktuell.id) ? 'page' : undefined }, t.titel,
  ))));
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
