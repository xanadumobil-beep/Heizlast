// Heizkörper eines Raums: Karten im Raumdetail und die Eingabemaske.

import * as db from '../db.js';
import { el } from '../ui.js';
import { oeffneDialog } from '../dialog.js';
import { formatZahl, zahlZuText } from '../engine/format.js';
import { sortierteKennlinie } from '../engine/radiator.js';
import { validiereHeizkoerper } from '../validate.js';
import { parseKennlinie, kennlinieZuText, normleistungVon } from '../modell.js';
import {
  BAUARTEN_HK, HK_STATI, VENTILE, HK_TYPEN, MATERIALIEN, werte, label, neuerHeizkoerper, heizkoerperFelder, normWahlVon,
} from '../schemas.js';

const OPTIONEN = { bauarten: werte(BAUARTEN_HK), stati: werte(HK_STATI), ventile: werte(VENTILE) };

// Fehlt die Leistung? Wärmepumpen-Heizkörper brauchen zwei Wertepaare, die übrigen eine Normleistung.
export function leistungFehlt(h) {
  return h.bauart === 'wp' ? sortierteKennlinie(h.kennlinie).length < 2 : normleistungVon(h) === null;
}

function leistungsText(h) {
  if (leistungFehlt(h)) return 'Leistung fehlt';
  if (h.bauart === 'wp') {
    const paare = sortierteKennlinie(h.kennlinie);
    return `Kennlinie: ${paare.length} Wertepaare, ${zahlZuText(paare[0].vorlauf)} bis ${zahlZuText(paare[paare.length - 1].vorlauf)} °C Vorlauf, `
      + `für ${zahlZuText(h.kennlinieRaumtemperatur)} °C Raumtemperatur`;
  }
  const phi = normleistungVon(h);
  const ausGliedern = !(h.normleistung > 0);
  return `${formatZahl(phi, 0)} W bei ${zahlZuText(h.normVorlauf)}/${zahlZuText(h.normRuecklauf)}/${zahlZuText(h.normRaum)} °C`
    + `${ausGliedern ? ` (${h.gliederzahl} Glieder × ${formatZahl(h.leistungJeGlied, 0)} W)` : ''}`
    + `, n = ${typeof h.exponent === 'number' ? zahlZuText(h.exponent) : 'Standard'}`;
}

function massText(h) {
  const teile = [['H', h.bauhoehe], ['L', h.baulaenge], ['T', h.bautiefe]].filter(([, w]) => typeof w === 'number');
  const text = teile.map(([k, w]) => `${k} ${zahlZuText(w)}`).join(' × ');
  return [text ? `${text} mm` : null, typeof h.nabenabstand === 'number' ? `Nabenabstand ${zahlZuText(h.nabenabstand)} mm` : null]
    .filter(Boolean).join(' · ');
}

export function bearbeiteHeizkoerper(raum, heizkoerper, neuLaden) {
  const istNeu = !heizkoerper.id;
  oeffneDialog({
    titel: istNeu ? `Heizkörper in „${raum.name}“` : 'Heizkörper bearbeiten',
    felder: heizkoerperFelder(),
    werteVorgabe: { ...heizkoerper, kennlinieText: kennlinieZuText(heizkoerper.kennlinie), normWahl: normWahlVon(heizkoerper) },
    validiere: (gelesen) => validiereHeizkoerper(gelesen, OPTIONEN),
    speichern: async (gelesen) => {
      const { kennlinieText, normWahl, ...rest } = gelesen;
      await db.speichere('radiators', {
        ...rest, raumId: raum.id, kennlinie: parseKennlinie(kennlinieText).paare, id: rest.id ?? db.neueId(),
      });
      neuLaden();
    },
  });
}

function karte(raum, h, neuLaden) {
  const fehlt = leistungFehlt(h);
  const titel = `${label(BAUARTEN_HK, h.bauart)}${h.bauart === 'platten' && h.typ ? ` Typ ${label(HK_TYPEN, h.typ)}` : ''}`;
  return el(
    'article', { class: fehlt && h.status !== 'entfaellt' ? 'karte markiert' : 'karte' },
    el(
      'h3', {}, titel,
      el('span', { class: h.status === 'entfaellt' ? 'marke ruhig' : 'marke' }, label(HK_STATI, h.status)),
      fehlt ? el('span', { class: 'marke' }, '⚠ Leistung fehlt') : null,
      h.ventil === 'alt' ? el('span', { class: 'marke ruhig' }, 'altes Ventil') : null,
    ),
    el('p', { class: 'zeile' }, `Leistung: ${leistungsText(h)}`),
    massText(h) ? el('p', { class: 'zeile' }, massText(h)) : null,
    h.material ? el('p', { class: 'zeile' }, `Material: ${label(MATERIALIEN, h.material)}`) : null,
    h.ventil === 'alt'
      ? el('p', { class: 'zeile' }, 'Altes Ventil: kein hydraulischer Abgleich möglich. Nur ein Hinweis, die Leistung ändert sich nicht.')
      : null,
    h.notiz ? el('p', { class: 'zeile notiz' }, h.notiz) : null,
    el(
      'div', { class: 'knopfzeile' },
      el('button', { type: 'button', onClick: () => bearbeiteHeizkoerper(raum, h, neuLaden) }, 'Bearbeiten'),
      el('button', {
        type: 'button', onClick: () => bearbeiteHeizkoerper(raum, { ...h, id: undefined }, neuLaden),
      }, 'Kopieren'),
      el('button', {
        type: 'button', class: 'gefahr',
        onClick: async () => {
          if (!confirm(`Diesen Heizkörper aus „${raum.name}“ löschen?`)) return;
          await db.loesche('radiators', h.id);
          neuLaden();
        },
      }, 'Löschen'),
    ),
  );
}

// Abschnitt "Heizkörper" im Raumdetail. Nur beheizte Räume haben Heizkörper.
export function heizkoerperAbschnitt(projekt, raum, neuLaden) {
  if (raum.status !== 'beheizt') {
    return el(
      'p', { class: 'zeile abstand' },
      'Heizkörper gibt es nur in beheizten Räumen. Passiv mitbeheizte Räume erhalten ihre Wärme über die Zuordnung zu liefernden Räumen.',
    );
  }
  const eigene = projekt.heizkoerper.filter((h) => h.raumId === raum.id);
  return el(
    'section', { class: 'abstand' },
    el(
      'div', { class: 'kopf' },
      el('h3', {}, 'Heizkörper'),
      el('button', { type: 'button', class: 'primaer', onClick: () => bearbeiteHeizkoerper(raum, neuerHeizkoerper(raum.id), neuLaden) }, '+ Heizkörper'),
    ),
    eigene.length > 0
      ? el('div', { class: 'karten' }, eigene.map((h) => karte(raum, h, neuLaden)))
      : el('p', { class: 'leer' }, 'Noch keine Heizkörper. Ohne Heizkörper gibt es für diesen Raum keine Vorlauftemperatur.'),
  );
}
