// Kataloge: Zonen, Bauteile und Öffnungstypen.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { oeffneDialog } from '../dialog.js';
import { hatFehler, hatWarnungen, validiereZone, validiereBauteil, validiereOeffnungstyp } from '../validate.js';
import {
  ZONEN_FELDER, BAUTEIL_FELDER, OEFFNUNGS_FELDER, ZONENARTEN, BAUTEILARTEN, OEFFNUNGSARTEN, QUELLEN, werte,
  neueZone, neuesBauteil, neuerOeffnungstyp, zoneZeilen, bauteilZeilen, oeffnungsZeilen,
} from '../schemas.js';

// verwendung(flaechen, id) zählt, wie oft ein Eintrag in Raumflächen vorkommt.
export const KATALOGE = {
  zonen: {
    store: 'zones',
    titel: 'Zonen',
    objekt: 'Zone',
    beschreibung:
      'Angrenzende Bereiche mit einer Temperatur als Minimum und Maximum: Erdreich, unbeheizte Kellerräume, Nachbargebäude. '
      + 'Außenluft ist keine Zone, sie folgt der Normaußentemperatur in den Einstellungen. '
      + 'Passiv mitbeheizte Räume legst du unter „Räume“ an.',
    felder: ZONEN_FELDER,
    neu: neueZone,
    validiere: (zone) => validiereZone(zone, werte(ZONENARTEN)),
    zeilen: zoneZeilen,
    verwendung: (flaechen, id) => flaechen.filter((f) => f.angrenzend?.zoneId === id).length,
  },
  bauteile: {
    store: 'components',
    titel: 'Bauteile',
    objekt: 'Bauteil',
    beschreibung: 'Bauteilkatalog mit U-Wert als Minimum und Maximum. Die Raumflächen verweisen auf diese Einträge.',
    felder: BAUTEIL_FELDER,
    neu: neuesBauteil,
    validiere: (bauteil) => validiereBauteil(bauteil, werte(BAUTEILARTEN), werte(QUELLEN)),
    zeilen: bauteilZeilen,
    verwendung: (flaechen, id) => flaechen.filter((f) => f.bauteilId === id).length,
  },
  oeffnungen: {
    store: 'openingTypes',
    titel: 'Öffnungen',
    objekt: 'Öffnungstyp',
    beschreibung: 'Fenster- und Türtypen mit Uw-Wert. Die Öffnungen einer Raumfläche werden von deren Fläche abgezogen.',
    felder: OEFFNUNGS_FELDER,
    neu: neuerOeffnungstyp,
    validiere: (typ) => validiereOeffnungstyp(typ, werte(OEFFNUNGSARTEN), werte(QUELLEN)),
    zeilen: oeffnungsZeilen,
    verwendung: (flaechen, id) => flaechen.flatMap((f) => f.oeffnungen ?? []).filter((o) => o.typId === id).length,
  },
};

export async function renderKatalog(container, katalog, neuLaden) {
  const [eintraege, flaechen] = await Promise.all([db.alle(katalog.store), db.alle('surfaces')]);
  eintraege.sort((a, b) => a.name.localeCompare(b.name, 'de'));

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

  const loeschen = async (eintrag) => {
    const n = katalog.verwendung(flaechen, eintrag.id);
    const hinweis = n > 0
      ? `\n\nEr wird in ${n} Eintrag${n === 1 ? '' : 'en'} bei den Raumflächen verwendet. Diese bleiben erhalten, werden aber `
        + 'bei der Berechnung ausgelassen und markiert.'
      : '';
    if (!confirm(`${katalog.objekt} „${eintrag.name}“ löschen?${hinweis}`)) return;
    await db.loesche(katalog.store, eintrag.id);
    neuLaden();
  };

  const karten = eintraege.map((eintrag) => {
    const meldungen = katalog.validiere(eintrag);
    const markiert = hatWarnungen(meldungen) || hatFehler(meldungen);
    const n = katalog.verwendung(flaechen, eintrag.id);
    return el(
      'article', { class: markiert ? 'karte markiert' : 'karte' },
      el('h3', {}, eintrag.name, markiert ? el('span', { class: 'marke' }, '⚠ prüfen') : null),
      katalog.zeilen(eintrag).filter(Boolean).map((zeile) => el('p', { class: 'zeile' }, zeile)),
      el('p', { class: 'zeile' }, n > 0 ? `Verwendet in ${n} Raumfläche${n === 1 ? '' : 'n'}` : 'Noch nicht verwendet'),
      meldungen.map((m) => el('p', { class: `meldung ${m.stufe}` }, `⚠ ${m.text}`)),
      el(
        'div', { class: 'knopfzeile' },
        el('button', { type: 'button', onClick: () => bearbeiten(eintrag) }, 'Bearbeiten'),
        el('button', {
          type: 'button',
          onClick: () => bearbeiten({ ...eintrag, id: undefined, name: `${eintrag.name} (Kopie)` }),
        }, 'Kopieren'),
        el('button', { type: 'button', class: 'gefahr', onClick: () => loeschen(eintrag) }, 'Löschen'),
      ),
    );
  });

  ersetzeKinder(container, 
    el(
      'div', { class: 'kopf' },
      el('h2', {}, katalog.titel),
      el('button', { type: 'button', class: 'primaer', onClick: () => bearbeiten(katalog.neu()) }, `+ ${katalog.objekt}`),
    ),
    el('p', { class: 'beschreibung' }, katalog.beschreibung),
    karten.length > 0
      ? el('div', { class: 'karten' }, karten)
      : el('p', { class: 'leer' }, `Noch keine Einträge. Mit „+ ${katalog.objekt}“ legst du den ersten an.`),
  );
}
