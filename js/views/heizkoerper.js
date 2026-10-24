// Heizkörper eines Raums: Karten im Raumdetail und die Eingabemaske.

import * as db from '../db.js';
import { el } from '../ui.js';
import { oeffneDialog } from '../dialog.js';
import { fotoMarkenZeile } from './fotos.js';
import { validiereHeizkoerper } from '../validate.js';
import { parseKennlinie, kennlinieZuText } from '../modell.js';
import { leistungFehlt, heizkoerperLeistungsText as leistungsText, heizkoerperMasseText as massText } from '../anzeige.js';
import {
  BAUARTEN_HK, HK_STATI, VENTILE, HK_TYPEN, MATERIALIEN, werte, label, neuerHeizkoerper, heizkoerperFelder, normWahlVon,
} from '../schemas.js';

const OPTIONEN = { bauarten: werte(BAUARTEN_HK), stati: werte(HK_STATI), ventile: werte(VENTILE) };

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

function karte(projekt, raum, h, neuLaden) {
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
    fotoMarkenZeile(projekt, 'heizkoerper', h.id),
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
      ? el('div', { class: 'karten' }, eigene.map((h) => karte(projekt, raum, h, neuLaden)))
      : el('p', { class: 'leer' }, 'Noch keine Heizkörper. Ohne Heizkörper gibt es für diesen Raum keine Vorlauftemperatur.'),
  );
}
