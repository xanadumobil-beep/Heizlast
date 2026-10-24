// Vorlauftemperatur: Ergebnis-Tabelle je beheiztem Raum mit Regler für die Ziel-Vorlauftemperatur.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { ladeProjekt, rechne, bewerteVorlauf } from '../daten.js';
import { formatZahl, zahlZuText } from '../engine/format.js';
import { VORLAUF_MIN, VORLAUF_MAX } from '../engine/vorlauf.js';
import { vorlaufText, hinweisText } from '../anzeige.js';

const watt = (x) => `${formatZahl(x, 0)} W`;
const mitVorzeichen = (x) => `${x > 0 ? '+' : ''}${formatZahl(x, 0)} W`.replace('-', '−');

const vorlaufKlasse = (v) => (['leistung_fehlt', 'nicht_deckbar', 'kein_heizkoerper', 'unbestimmt'].includes(v.status) ? 'warnwert' : '');

function zelle(inhalt, klasse = '') {
  return el('td', { class: `zahl ${klasse}`.trim() }, inhalt);
}

function baueTabelle(bewertung, ziel) {
  const kopf = [
    'Raum', 'Heizlast', 'davon Raum-zu-Raum', 'davon passiv', `Installiert bei ${ziel} °C`, 'Deckung',
    'Über-/Unterdeckung', 'Nötiger Vorlauf (ungünstig)', 'Nötiger Vorlauf (günstig)',
  ];
  // Je Raum eine Zeile mit den Zahlen und, falls nötig, eine Zeile mit den Hinweisen darunter.
  const zeilen = bewertung.zeilen.map((z) => [el(
    'tr', { class: z.bestimmend ? 'bestimmend' : '' },
    el(
      'th', { scope: 'row' },
      z.name,
      z.bestimmend ? el('span', { class: 'marke' }, 'bestimmender Raum') : null,
      el('small', { class: 'unterzeile' }, `${zahlZuText(z.theta)} °C`),
    ),
    el('td', { class: 'zahl' }, watt(z.heizlast), el('small', { class: 'unterzeile' }, `günstig ${watt(z.heizlastGuenstig)}`)),
    zelle(watt(z.davonRaumZuRaum)),
    zelle(watt(z.davonPassiv)),
    zelle(z.installiert === null ? '–' : watt(z.installiert)),
    zelle(z.deckung === null ? '–' : `${formatZahl(z.deckung, 0)} %`, z.deckung !== null && z.deckung < 100 ? 'unter' : 'ueber'),
    zelle(z.differenz === null ? '–' : mitVorzeichen(z.differenz), z.differenz !== null && z.differenz < 0 ? 'unter' : 'ueber'),
    zelle(vorlaufText(z.vorlauf), `${vorlaufKlasse(z.vorlauf)} ${z.bestimmend ? 'stark' : ''}`),
    zelle(vorlaufText(z.vorlaufGuenstig), vorlaufKlasse(z.vorlaufGuenstig)),
  ), z.hinweise.length > 0
    ? el(
      'tr', { class: `hinweiszeile${z.bestimmend ? ' bestimmend' : ''}`, 'data-raum': z.name },
      el('td', { colspan: kopf.length }, el('ul', {}, z.hinweise.map((h) => el('li', {}, hinweisText(h, ziel))))),
    )
    : null]);
  return el(
    'div', { class: 'tabellenrahmen' },
    el(
      'table', { class: 'tabelle gross-tabelle' },
      el('thead', {}, el('tr', {}, kopf.map((k, i) => el('th', { class: i > 0 ? 'zahl' : '' }, k)))),
      el('tbody', {}, zeilen.flat()),
    ),
  );
}

function zusammenfassung(bewertung, projekt) {
  const raumName = (id) => bewertung.zeilen.find((z) => z.raumId === id)?.name;
  const best = bewertung.zeilen.find((z) => z.bestimmend);
  const bloecke = [];
  if (best) {
    const v = best.vorlauf;
    bloecke.push(el(
      'p', { class: 'gross' },
      v.status === 'ok' ? `${formatZahl(v.vorlauf, 1)} °C` : `über ${VORLAUF_MAX} °C`,
    ));
    bloecke.push(el(
      'p', { class: 'zeile' },
      `Bestimmender Raum: ${best.name}`,
      v.status === 'ok' ? ` · günstige Rechnung: ${vorlaufText(best.vorlaufGuenstig)}` : ' · auch bei der Maximaltemperatur nicht gedeckt',
    ));
  } else {
    bloecke.push(el('p', { class: 'zeile' }, 'Noch kein Raum mit berechenbarer Vorlauftemperatur.'));
  }
  if (bewertung.unsicher.length > 0) {
    bloecke.push(el(
      'p', { class: 'meldung warnung' },
      `⚠ Für ${bewertung.unsicher.map(raumName).map((n) => `„${n}“`).join(', ')} konnte keine Vorlauftemperatur bestimmt werden `
      + '(Leistung fehlt, kein Heizkörper oder Datenblattwerte zu knapp). Der bestimmende Raum ist deshalb unsicher.',
    ));
  }
  bloecke.push(el(
    'p', { class: 'hinweis' },
    `Rücklauf = Vorlauf − ${zahlZuText(projekt.einstellungen.spreizung)} K Spreizung, Raumtemperatur = Soll-Temperatur des Raums. `
    + 'Die nötige Vorlauftemperatur ist die kleinste, bei der die Heizkörper mit Status „Bleibt“, „Neu“ und „Geplant“ die ungünstige Heizlast decken. '
    + 'Die Heizlast enthält zugerechnete Anteile passiver Räume und Raum-zu-Raum-Verluste, siehe die beiden Spalten dazu.',
  ));
  return bloecke;
}

export async function renderVorlauf(container) {
  const projekt = await ladeProjekt();
  const { ergebnis, fehler } = rechne(projekt);
  if (fehler || !ergebnis) {
    ersetzeKinder(container, el('h2', {}, 'Vorlauf'), el('p', { class: 'meldung fehler' }, `Rechenfehler: ${fehler ?? 'kein Ergebnis'}`));
    return;
  }

  let ziel = Math.min(VORLAUF_MAX, Math.max(VORLAUF_MIN, projekt.einstellungen.zielVorlauf ?? 45));
  const spreizung = projekt.einstellungen.spreizung;
  const bereich = el('div', {});
  const anzeige = el('output', { class: 'zielwert', 'aria-live': 'polite' });
  const regler = el('input', {
    type: 'range', min: VORLAUF_MIN, max: VORLAUF_MAX, step: 1, value: ziel, 'aria-label': 'Ziel-Vorlauftemperatur', class: 'regler',
  });

  const zeichne = () => {
    anzeige.textContent = `${ziel} °C`;
    const bewertung = bewerteVorlauf(projekt, ergebnis, ziel);
    ersetzeKinder(
      bereich,
      ...(bewertung.zeilen.length > 0
        ? [baueTabelle(bewertung, ziel)]
        : [el('p', { class: 'leer' }, 'Noch keine beheizten Räume. Lege unter „Räume“ Räume und Heizkörper an.')]),
    );
    return bewertung;
  };

  const setze = (wert) => {
    ziel = Math.min(VORLAUF_MAX, Math.max(VORLAUF_MIN, Math.round(wert)));
    regler.value = String(ziel);
    zeichne();
  };
  const speichereZiel = () => db.speichere('settings', { ...projekt.einstellungen, zielVorlauf: ziel });

  regler.addEventListener('input', () => setze(Number(regler.value)));
  regler.addEventListener('change', speichereZiel);

  const erste = bewerteVorlauf(projekt, ergebnis, ziel);
  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Vorlauf')),
    el('p', { class: 'beschreibung' }, 'Welche Vorlauftemperatur braucht jeder Raum, und wie gut deckt eine gewählte Vorlauftemperatur die Heizlast?'),
    el('section', { class: 'karte gebaeude' }, el('h3', {}, 'Nötige Vorlauftemperatur des Hauses'), ...zusammenfassung(erste, projekt)),
    el(
      'section', { class: 'karte regleranzeige' },
      el('h3', {}, 'Ziel-Vorlauftemperatur'),
      el(
        'div', { class: 'reglerzeile' },
        el('button', { type: 'button', 'aria-label': 'Ein Grad weniger', onClick: () => { setze(ziel - 1); speichereZiel(); } }, '−'),
        regler,
        el('button', { type: 'button', 'aria-label': 'Ein Grad mehr', onClick: () => { setze(ziel + 1); speichereZiel(); } }, '+'),
        anzeige,
      ),
      el('p', { class: 'hinweis' }, `Rücklauf ${spreizung > 0 ? `${ziel - spreizung} °C` : `${ziel} °C`} bei ${zahlZuText(spreizung)} K Spreizung. Die Tabelle zeigt Leistung, Deckung und Über- oder Unterdeckung bei dieser Temperatur.`),
    ),
    bereich,
  );
  zeichne();
}
