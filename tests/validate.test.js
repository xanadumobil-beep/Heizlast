// Tests für die Plausibilitätsprüfung und die Standardwerte.

import { test, wahr } from './runner.js';
import {
  hatFehler, hatWarnungen, validiereEinstellungen, validiereZone, validiereBauteil,
  validiereOeffnungstyp, validiereRaum,
} from '../js/validate.js';
import { standardEinstellungen, standardZonen, ZONENARTEN, BAUTEILARTEN, OEFFNUNGSARTEN, QUELLEN, werte } from '../js/schemas.js';
import { zahlZuText } from '../js/engine/format.js';

const arten = werte(BAUTEILARTEN);
const quellen = werte(QUELLEN);
const zonenarten = werte(ZONENARTEN);
const oeffnungsarten = werte(OEFFNUNGSARTEN);

const bauteil = (u, rest = {}) => ({ name: 'Wand', art: 'aussenwand', u, quelle: 'stempel', ...rest });
const feldMeldung = (meldungen, feld, stufe) => meldungen.find((m) => m.feld === feld && m.stufe === stufe);

test('Standardeinstellungen und Standardzone sind plausibel', () => {
  wahr(validiereEinstellungen(standardEinstellungen()).length === 0, 'Standardeinstellungen ohne Meldung erwartet');
  const zone = standardZonen()[0];
  wahr(validiereZone(zone, zonenarten).length === 0, 'Standardzone ohne Meldung erwartet');
  wahr(zone.temperatur.min === 8 && zone.temperatur.max === 12, 'Erdreich 8 bis 12 °C erwartet');
});

test('Standardwerte laut Vorgabe: −8 °C, ΔU_WB 0,05/0,15, n 0,5/1,0', () => {
  const e = standardEinstellungen();
  wahr(e.thetaAussen === -8 && e.dUWB.min === 0.05 && e.dUWB.max === 0.15, 'ΔU_WB oder Außentemperatur falsch');
  wahr(e.luftwechselStandard.min === 0.5 && e.luftwechselStandard.max === 1, 'Luftwechsel falsch');
  wahr(e.aufheizzuschlag.aktiv === false, 'Aufheizzuschlag muss aus sein');
});

test('U-Wert über 6 wird markiert, bleibt aber speicherbar', () => {
  const meldungen = validiereBauteil(bauteil({ min: 7, max: 7 }), arten, quellen);
  wahr(feldMeldung(meldungen, 'u', 'warnung'), 'Warnung fehlt');
  wahr(!hatFehler(meldungen), 'darf kein Fehler sein');
});

test('U-Wert 0, leer oder unlesbar ist ein Fehler', () => {
  wahr(hatFehler(validiereBauteil(bauteil({ min: 0, max: 1 }), arten, quellen)), 'U = 0');
  wahr(hatFehler(validiereBauteil(bauteil({ min: null, max: 1 }), arten, quellen)), 'leer');
  wahr(hatFehler(validiereBauteil(bauteil({ min: NaN, max: 1 }), arten, quellen)), 'unlesbar');
});

test('U-Wert: Minimum über Maximum ist ein Fehler', () => {
  const meldungen = validiereBauteil(bauteil({ min: 1.4, max: 1.2 }), arten, quellen);
  wahr(feldMeldung(meldungen, 'u', 'fehler'), 'Fehler fehlt');
});

test('Bauteil ohne Namen ist ein Fehler', () => {
  wahr(hatFehler(validiereBauteil(bauteil({ min: 1, max: 1 }, { name: '  ' }), arten, quellen)), 'Name');
});

test('Zone: Minimum über Maximum ist ein Fehler, Erdreich über 20 °C eine Warnung', () => {
  const zone = (min, max, art = 'unbeheizt') => ({ name: 'Z', art, temperatur: { min, max } });
  wahr(hatFehler(validiereZone(zone(12, 8), zonenarten)), 'Reihenfolge');
  const meldungen = validiereZone(zone(8, 25, 'erdreich'), zonenarten);
  wahr(hatWarnungen(meldungen) && !hatFehler(meldungen), 'Warnung erwartet');
});

test('Öffnungstyp: Uw über 6 ist eine Warnung, Uw 0 ein Fehler', () => {
  const typ = (uw) => ({ name: 'F', art: 'fenster', uw, quelle: 'rechnung' });
  wahr(hatWarnungen(validiereOeffnungstyp(typ(7), oeffnungsarten, quellen)), 'Warnung bei 7');
  wahr(hatFehler(validiereOeffnungstyp(typ(0), oeffnungsarten, quellen)), 'Fehler bei 0');
});

test('Raum: Fläche 0 und Höhe über 6 m werden markiert', () => {
  const raum = (flaeche, hoehe) => ({ name: 'R', flaeche, hoehe, theta: 20, luftwechsel: null });
  wahr(feldMeldung(validiereRaum(raum(0, 2.5)), 'flaeche', 'warnung'), 'Fläche 0');
  wahr(feldMeldung(validiereRaum(raum(15, 6.5)), 'hoehe', 'warnung'), 'Höhe 6,5');
  wahr(validiereRaum(raum(15, 2.5)).length === 0, 'plausibler Raum ohne Meldung');
  wahr(hatFehler(validiereRaum(raum(-3, 2.5))), 'negative Fläche ist ein Fehler');
});

test('Einstellungen: unlesbare Eingabe blockiert, Luftwechsel min > max blockiert', () => {
  const e = standardEinstellungen();
  wahr(hatFehler(validiereEinstellungen({ ...e, thetaAussen: NaN })), 'unlesbare Temperatur');
  wahr(hatFehler(validiereEinstellungen({ ...e, luftwechselStandard: { min: 1, max: 0.5 } })), 'Luftwechsel');
  wahr(hatWarnungen(validiereEinstellungen({ ...e, thetaAussen: -30 })), 'Warnung bei −30 °C');
});

test('Zahlen erscheinen mit Komma im Eingabefeld', () => {
  wahr(zahlZuText(0.15) === '0,15', '0,15');
  wahr(zahlZuText(-8) === '-8', '-8');
  wahr(zahlZuText(null) === '', 'null ist leer');
});

// --- Räume, Raumflächen, Öffnungen -----------------------------------------------------

import {
  validiereRaumEingabe, validiereFlaeche, validiereOeffnungEintrag,
} from '../js/validate.js';
import { STATI, GESCHOSSE } from '../js/schemas.js';

const raumOptionen = { stati: werte(STATI), geschosse: werte(GESCHOSSE) };
const flaechenOptionen = { bauteilIds: ['b1'], angrenzendWerte: ['aussen', 'raum:r1'] };

test('Raummaske: unbeheizter Raum braucht keine Soll-Temperatur, beheizter schon', () => {
  const raum = (status, theta) => ({
    name: 'R', geschoss: 'EG', status, theta, flaeche: 12, hoehe: 2.5, volumenManuell: null, luftwechsel: null,
  });
  wahr(!hatFehler(validiereRaumEingabe(raum('unbeheizt', null), raumOptionen)), 'unbeheizt ohne Temperatur');
  wahr(hatFehler(validiereRaumEingabe(raum('beheizt', null), raumOptionen)), 'beheizt ohne Temperatur');
  wahr(hatFehler(validiereRaumEingabe({ ...raum('beheizt', 20), status: 'kaputt' }, raumOptionen)), 'ungültiger Status');
});

test('Raummaske: manuelles Volumen muss positiv sein, leer ist erlaubt', () => {
  const raum = (volumenManuell) => ({
    name: 'R', geschoss: 'EG', status: 'beheizt', theta: 20, flaeche: 12, hoehe: 2.5, volumenManuell, luftwechsel: null,
  });
  wahr(validiereRaumEingabe(raum(null), raumOptionen).length === 0, 'leer');
  wahr(hatFehler(validiereRaumEingabe(raum(0), raumOptionen)), 'Volumen 0');
  wahr(hatFehler(validiereRaumEingabe(raum(NaN), raumOptionen)), 'Volumen unlesbar');
});

test('Raumfläche: Bauteil und Gegenseite sind Pflicht, Maße je nach Maßart', () => {
  const basisFlaeche = { bauteilId: 'b1', angrenzendWahl: 'aussen', modus: 'laengeHoehe', laenge: 4, hoehe: 2.5 };
  wahr(validiereFlaeche(basisFlaeche, flaechenOptionen).length === 0, 'gültige Fläche');
  wahr(feldMeldung(validiereFlaeche({ ...basisFlaeche, bauteilId: '' }, flaechenOptionen), 'bauteilId', 'fehler'), 'Bauteil fehlt');
  wahr(feldMeldung(validiereFlaeche({ ...basisFlaeche, angrenzendWahl: '' }, flaechenOptionen), 'angrenzendWahl', 'fehler'), 'Gegenseite fehlt');
  wahr(feldMeldung(validiereFlaeche({ ...basisFlaeche, laenge: null }, flaechenOptionen), 'laenge', 'fehler'), 'Länge fehlt');
  wahr(hatFehler(validiereFlaeche({ ...basisFlaeche, modus: 'flaeche', flaeche: null }, flaechenOptionen)), 'Fläche fehlt');
  // Bei direkter Fläche zählen Länge und Höhe nicht.
  wahr(!hatFehler(validiereFlaeche({ ...basisFlaeche, modus: 'flaeche', flaeche: 10, laenge: null, hoehe: null }, flaechenOptionen)), 'direkte Fläche');
});

test('Raumfläche: Fläche 0 und Höhe über 6 m werden markiert, bleiben aber speicherbar', () => {
  const basisFlaeche = { bauteilId: 'b1', angrenzendWahl: 'aussen', modus: 'laengeHoehe', laenge: 4, hoehe: 2.5 };
  const null0 = validiereFlaeche({ ...basisFlaeche, modus: 'flaeche', flaeche: 0 }, flaechenOptionen);
  wahr(feldMeldung(null0, 'flaeche', 'warnung') && !hatFehler(null0), 'Fläche 0');
  const hoch = validiereFlaeche({ ...basisFlaeche, hoehe: 6.5 }, flaechenOptionen);
  wahr(feldMeldung(hoch, 'hoehe', 'warnung') && !hatFehler(hoch), 'Höhe 6,5');
});

test('Öffnung: Typ und Maße, Anzahl nur als ganze Zahl ab 1', () => {
  const o = { typId: 't1', modus: 'laengeHoehe', laenge: 1.2, hoehe: 1.4, anzahl: 2 };
  const optionen = { typIds: ['t1'] };
  wahr(validiereOeffnungEintrag(o, optionen).length === 0, 'gültige Öffnung');
  wahr(hatFehler(validiereOeffnungEintrag({ ...o, typId: '' }, optionen)), 'Typ fehlt');
  wahr(hatFehler(validiereOeffnungEintrag({ ...o, anzahl: 0 }, optionen)), 'Anzahl 0');
  wahr(hatFehler(validiereOeffnungEintrag({ ...o, anzahl: 1.5 }, optionen)), 'Anzahl 1,5');
  wahr(hatFehler(validiereOeffnungEintrag({ ...o, anzahl: null }, optionen)), 'Anzahl leer');
  wahr(hatFehler(validiereOeffnungEintrag({ ...o, laenge: null }, optionen)), 'Breite fehlt');
});
