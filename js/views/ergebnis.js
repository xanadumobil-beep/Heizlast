// Ergebnis: erste Ansicht der App. Gesamtheizlast, Verluste nach Art, benötigte Wärmepumpenleistung,
// Heizlast bei verschiedenen Außentemperaturen, Plausibilität und Datenqualität.
// Der Ist-Zustand steht immer links, optional daneben ein Szenario. Die Zahlen kommen aus js/ergebnis.js.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { formatZahl, parseDezimal, zahlZuText } from '../engine/format.js';
import { ladeIstProjekt, ladeSzenarien, ladeAktivesSzenario } from '../daten.js';
import { wendeSzenarioAn } from '../szenario.js';
import { watt, wattBereichVon } from '../anzeige.js';
import {
  baueErgebnis, benoetigtText, ampelText, zaehlerText, liniePunktText, waermepumpenannahmen, TYPEN_HINWEIS, MILD_HINWEIS,
  AUSSENTEMPERATUREN,
} from '../ergebnis.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, eigenschaften = {}) => {
  const knoten = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(eigenschaften)) knoten.setAttribute(k, v);
  return knoten;
};

// Gewählter Vergleich (id eines Szenarios oder ''), bleibt beim Wechseln der Ansicht erhalten.
let vergleichsWahl = null;

const kW = (w, stellen = 1) => `${formatZahl(w / 1000, stellen)} kW`;

function ampelKarte(erg, springeZurListe) {
  const q = erg.qualitaet;
  const symbol = { gruen: '●', gelb: '●', rot: '●' }[q.ampel];
  return el(
    'section', { class: `ergebnis-ampel ${q.ampel}`, 'data-ampel': q.ampel },
    el('p', { class: 'ampel-kopf' }, el('span', { class: 'ampel-punkt', 'aria-hidden': 'true' }, symbol), ' ', el('strong', {}, ampelText[q.ampel]), ': ', q.meldung),
    el('ul', { class: 'ampel-zaehler' }, zaehlerText(q.zaehler).map(([name, n]) => el('li', { class: n > 0 ? 'offen' : '' }, `${name}: `, el('strong', {}, String(n))))),
    q.ampel !== 'gruen' ? el('div', { class: 'knopfzeile' }, el('button', { type: 'button', onClick: springeZurListe }, 'Zur Liste der Lücken'), el('a', { class: 'knopf', href: '#plan' }, 'Plan mit Vollständigkeitsprüfung')) : null,
  );
}

function verlustBalken(erg) {
  return el(
    'div', { class: 'verlustliste' },
    erg.verluste.zeilen.map((v) => el(
      'div', { class: 'verlustzeile' },
      el('span', { class: 'v-name' }, v.name),
      el('span', { class: 'v-balken', role: 'img', 'aria-label': `${v.name}: ${formatZahl(v.prozent, 1)} Prozent` }, el('span', { style: `width: ${Math.max(0, Math.min(100, v.prozent))}%` })),
      el('span', { class: 'v-wert' }, `${watt(v.w)} · ${formatZahl(v.prozent, 1)} %`),
    )),
    el('p', { class: 'zeile' }, `Summe ${watt(erg.verluste.summe)} (Mittelwert, entspricht der Gebäudeheizlast)`),
  );
}

function linienDiagramm(linie) {
  const b = 320;
  const h = 150;
  const rand = { l: 36, r: 8, o: 8, u: 24 };
  const xs = AUSSENTEMPERATUREN;
  const x0 = Math.min(...xs) - 1;
  const x1 = Math.max(...xs) + 1;
  const ymax = Math.max(...linie.punkte.map((p) => p.max), 1);
  const px = (t) => rand.l + ((t - x0) / (x1 - x0)) * (b - rand.l - rand.r);
  const py = (w) => h - rand.u - (w / ymax) * (h - rand.u - rand.o);
  const svg = s('svg', { viewBox: `0 0 ${b} ${h}`, class: 'linien-svg', role: 'img', 'aria-label': 'Heizlast über der Außentemperatur' });
  const punkteText = (liste) => liste.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ');
  svg.append(
    s('line', { x1: rand.l, y1: h - rand.u, x2: b - rand.r, y2: h - rand.u, class: 'achse' }),
    s('line', { x1: rand.l, y1: rand.o, x2: rand.l, y2: h - rand.u, class: 'achse' }),
    s('polygon', { points: punkteText([...linie.punkte.map((p) => [p.theta, p.max]), ...[...linie.punkte].reverse().map((p) => [p.theta, p.min])]), class: 'band' }),
    s('polyline', { points: punkteText(linie.punkte.map((p) => [p.theta, p.max])), class: 'linie-max' }),
    s('polyline', { points: punkteText(linie.punkte.map((p) => [p.theta, p.min])), class: 'linie-min' }),
  );
  for (const p of linie.punkte) {
    const t = s('text', { x: px(p.theta), y: h - 8, 'text-anchor': 'middle', class: 'achsentext' });
    t.textContent = `${p.theta < 0 ? '−' : ''}${Math.abs(p.theta)}`;
    svg.append(t);
  }
  const oben = s('text', { x: rand.l - 4, y: rand.o + 8, 'text-anchor': 'end', class: 'achsentext' });
  oben.textContent = formatZahl(ymax / 1000, 1);
  const null_ = s('text', { x: rand.l - 4, y: h - rand.u, 'text-anchor': 'end', class: 'achsentext' });
  null_.textContent = '0';
  const einheit = s('text', { x: b - rand.r, y: h - 8, 'text-anchor': 'end', class: 'achsentext' });
  einheit.textContent = '°C';
  const kwText = s('text', { x: rand.l + 4, y: rand.o + 8, class: 'achsentext' });
  kwText.textContent = 'kW';
  svg.append(oben, null_, einheit, kwText);
  return svg;
}

function wpKarte(erg) {
  if (!erg.hatErgebnis) return el('p', { class: 'leer' }, 'Keine berechenbaren Räume.');
  const w = erg.waermepumpe;
  const v = w.vorlauf;
  return el(
    'div', {},
    el('p', { class: `benoetigt ${v.art === 'ok' ? '' : 'warnwert'}`.trim(), 'data-benoetigt': true }, benoetigtText(erg)),
    el(
      'table', { class: 'tabelle zuschlagtabelle' },
      el('tbody', {},
        el('tr', {}, el('th', { scope: 'row' }, 'Obere Grenze der Gebäudeheizlast'), el('td', { class: 'zahl' }, kW(w.obereW, 3))),
        w.zuschlaege.map((x) => [
          el('tr', {}, el('th', { scope: 'row' }, `Zuschlag: ${x.name}`), el('td', { class: 'zahl' }, `+ ${kW(x.wert, 3)}`)),
          el('tr', { class: 'begruendung' }, el('td', { colspan: 2 }, x.begruendung)),
        ]),
        el('tr', { class: 'summe' }, el('th', { scope: 'row' }, 'Summe'), el('td', { class: 'zahl' }, kW(w.gesamtW, 3))),
      ),
    ),
    w.zuschlaege.length === 0 ? el('p', { class: 'zeile' }, 'Keine Zuschläge angesetzt. Es gibt keinen pauschalen Sicherheitszuschlag und keine Rundung auf Gerätegrößen.') : null,
    v.art === 'ok' ? el('p', { class: 'zeile' }, `Bestimmender Raum für den Vorlauf: „${v.raum}“ (ungünstige Heizlast).`) : null,
    v.luecken.map((t) => el('p', { class: 'meldung warnung' }, t)),
  );
}

function linieKarte(erg) {
  if (!erg.hatErgebnis) return el('p', { class: 'leer' }, '–');
  if (!erg.linie.ok) return el('p', { class: 'meldung warnung' }, `Nicht berechenbar: ${erg.linie.grund}.`);
  return el(
    'div', {},
    linienDiagramm(erg.linie),
    el(
      'table', { class: 'tabelle linientabelle' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Außentemperatur'), el('th', { scope: 'col', class: 'zahl' }, 'Untere Grenze'), el('th', { scope: 'col', class: 'zahl' }, 'Obere Grenze'))),
      el('tbody', {}, erg.linie.punkte.map((p) => {
        const t = liniePunktText(p);
        return el('tr', { 'data-theta': p.theta }, el('th', { scope: 'row' }, t.theta), el('td', { class: 'zahl' }, t.min), el('td', { class: 'zahl' }, t.max));
      })),
    ),
    el('p', { class: 'zeile' }, `H = Heizlast / (θ_soll,Mittel − θ_e) mit θ_soll,Mittel = ${formatZahl(erg.linie.thetaMittel, 1)} °C: ${formatZahl(erg.linie.hMin, 1)} bis ${formatZahl(erg.linie.hMax, 1)} W/K.`),
  );
}

function plausiKarte(erg, szenarioAnsicht) {
  if (szenarioAnsicht) return el('p', { class: 'zeile' }, 'Der Verbrauchsabgleich vergleicht gemessenen Verbrauch mit dem Ist-Zustand und gilt nur dort.');
  if (!erg.hatErgebnis) return el('p', { class: 'leer' }, '–');
  if (!erg.verbrauch || erg.verbrauch.length === 0) return el('p', { class: 'zeile' }, 'Kein Verbrauchsabgleich vorhanden. Mit einem Abgleich lässt sich die berechnete Heizlast gegen den Verbrauch prüfen.');
  return el('ul', { class: 'plausi' }, erg.verbrauch.map((v) => el(
    'li', {},
    el('strong', {}, v.name), ': ',
    v.ok ? `${wattBereichVon(v.band)} aus dem Verbrauch${v.abweichung ? `, ${v.abweichung}` : ''}` : 'unvollständig, nicht ausgewertet',
  )));
}

function listeDerLuecken(erg) {
  const q = erg.qualitaet;
  return el(
    'details', { class: 'karte luecken', 'data-luecken': true, open: q.ampel === 'rot' },
    el('summary', {}, `Liste der Lücken (${q.details.length})`),
    q.details.length === 0
      ? el('p', { class: 'zeile' }, 'Keine Lücken gefunden.')
      : el('ul', {}, q.details.map((d) => el('li', { class: d.rot ? 'rot' : '' }, d.text))),
  );
}

function sperrstundenFeld(wp, neuLaden) {
  const eingabe = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: wp.sperrstunden > 0 ? zahlZuText(wp.sperrstunden) : '', 'aria-label': 'Sperrzeit des Netzbetreibers in Stunden pro Tag', 'data-sperrstunden': true });
  const meldung = el('p', { class: 'meldung fehler', hidden: true });
  eingabe.addEventListener('change', async () => {
    const wert = parseDezimal(eingabe.value);
    if (Number.isNaN(wert) || (wert !== null && (wert < 0 || wert >= 24))) {
      meldung.textContent = 'Bitte eine Zahl von 0 bis unter 24 eingeben (Stunden Sperre je Tag).';
      meldung.hidden = false;
      return;
    }
    await db.speichereWaermepumpenannahmen({ sperrstunden: wert ?? 0 });
    neuLaden();
  });
  return el(
    'div', { class: 'sperrfeld' },
    el('label', {}, el('span', { class: 'klein' }, 'Sperrzeit des Netzbetreibers'), el('span', { class: 'mit-einheit' }, eingabe, el('span', { class: 'einheit' }, 'h pro Tag'))),
    el('p', { class: 'zeile' }, 'Ohne Eingabe gibt es keinen Zuschlag. Die App setzt keinen pauschalen Sicherheitszuschlag an.'),
    meldung,
  );
}

export async function renderErgebnis(container, neuLaden) {
  const [ist, szenarien, aktiv] = await Promise.all([ladeIstProjekt(), ladeSzenarien(), ladeAktivesSzenario()]);
  if (vergleichsWahl === null) vergleichsWahl = aktiv?.id ?? '';
  if (vergleichsWahl && !szenarien.some((x) => x.id === vergleichsWahl)) vergleichsWahl = '';
  const szenario = szenarien.find((x) => x.id === vergleichsWahl) ?? null;

  const ergIst = baueErgebnis(ist);
  const ergSz = szenario ? baueErgebnis({ ...wendeSzenarioAn(ist, szenario).projekt, szenario: { id: szenario.id, name: szenario.name } }, { mitVerbrauch: false }) : null;
  const ergebnisse = ergSz ? [ergIst, ergSz] : [ergIst];

  const wahl = el(
    'select', { 'aria-label': 'Szenario zum Vergleich', 'data-vergleich': true },
    el('option', { value: '' }, 'kein Vergleich'),
    szenarien.map((x) => el('option', { value: x.id }, `Szenario: ${x.name}`)),
  );
  wahl.value = vergleichsWahl;
  wahl.addEventListener('change', () => { vergleichsWahl = wahl.value; neuLaden(); });

  const spalten = (inhaltVon) => el(
    'div', { class: `ergebnis-spalten n${ergebnisse.length}` },
    ergebnisse.map((erg, i) => el('div', { class: 'ergebnis-spalte', 'data-ansicht': i === 0 ? 'ist' : 'szenario' }, ergebnisse.length > 1 ? el('h4', {}, erg.name) : null, inhaltVon(erg, i))),
  );
  const abschnitt = (titel, inhalt, extra = {}) => el('section', { class: 'karte ergebnis-abschnitt', ...extra }, el('h3', {}, titel), inhalt);

  const luecken = ergebnisse.map(listeDerLuecken);
  const springe = (i) => () => {
    luecken[i].open = true;
    luecken[i].scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Ergebnis')),
    el('p', { class: 'beschreibung' }, 'Die wichtigsten Zahlen auf einen Blick, bei der Normaußentemperatur. Links steht der Ist-Zustand, optional daneben ein Szenario.'),
    el('label', { class: 'berichtwahl' }, el('span', { class: 'klein' }, 'Vergleichen mit'), wahl),
    spalten((erg, i) => ampelKarte(erg, springe(i))),
    abschnitt('Gesamtheizlast', spalten((erg) => (erg.hatErgebnis
      ? el(
        'div', {},
        erg.fehler ? el('p', { class: 'meldung fehler' }, `Rechenfehler: ${erg.fehler}`) : null,
        el('p', { class: 'bandbreite' }, el('span', { class: 'klein' }, `Bandbreite bei ${erg.thetaAussen < 0 ? '−' : ''}${Math.abs(erg.thetaAussen)} °C (günstig bis ungünstig)`), el('strong', { class: 'gross' }, wattBereichVon(erg.bandbreite))),
        el('p', { class: 'zeile' }, `Mittelwert: ${watt(erg.mittel)}`),
        el('p', { class: 'obere', 'data-obere': true }, el('span', { class: 'klein' }, 'Obere Grenze (Auslegungswert)'), el('strong', { class: 'gross' }, watt(erg.obere))),
      )
      : el('p', { class: 'leer' }, erg.fehler ? `Rechenfehler: ${erg.fehler}` : 'Es gibt noch keine berechenbaren Räume.')))),
    abschnitt('Aufteilung nach Verlustart', spalten((erg) => (erg.hatErgebnis ? verlustBalken(erg) : el('p', { class: 'leer' }, '–')))),
    abschnitt('Benötigte Wärmepumpenleistung', el(
      'div', {},
      sperrstundenFeld(waermepumpenannahmen(ist.einstellungen), neuLaden),
      spalten((erg) => wpKarte(erg)),
      el('p', { class: 'meldung hinweis' }, TYPEN_HINWEIS),
    )),
    abschnitt('Heizlast bei verschiedenen Außentemperaturen', el(
      'div', {},
      el('p', { class: 'zeile' }, 'Vorbereitung für den Vergleich mit Wärmepumpenmodellen. Linear gerechnet, je Punkt untere und obere Grenze.'),
      spalten((erg) => linieKarte(erg)),
      el('p', { class: 'meldung hinweis' }, MILD_HINWEIS),
    )),
    abschnitt('Plausibilität: Verbrauchsabgleich', spalten((erg, i) => plausiKarte(erg, i > 0))),
    abschnitt('Datenqualität', spalten((erg, i) => luecken[i])),
  );
}
