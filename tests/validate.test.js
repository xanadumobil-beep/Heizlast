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

// --- Heizkörper ------------------------------------------------------------------------

import { validiereHeizkoerper } from '../js/validate.js';
import { BAUARTEN_HK, HK_STATI, VENTILE } from '../js/schemas.js';

const hkOptionen = { bauarten: werte(BAUARTEN_HK), stati: werte(HK_STATI), ventile: werte(VENTILE) };
const hk = (extra = {}) => ({
  bauart: 'platten', status: 'bleibt', ventil: 'neu', normleistung: 1000,
  normVorlauf: 75, normRuecklauf: 65, normRaum: 20, kennlinieText: '', kennlinieRaumtemperatur: 20, ...extra,
});

test('Heizkörper: vollständige Angaben ohne Meldung', () => {
  wahr(validiereHeizkoerper(hk(), hkOptionen).length === 0, 'keine Meldung erwartet');
});

test('Heizkörper ohne Leistung: Warnung "Leistung fehlt", aber speicherbar', () => {
  const meldungen = validiereHeizkoerper(hk({ normleistung: null }), hkOptionen);
  const w = feldMeldung(meldungen, 'normleistung', 'warnung');
  wahr(w && w.text.startsWith('Leistung fehlt'), 'Warnung "Leistung fehlt"');
  wahr(!hatFehler(meldungen), 'kein Fehler');
});

test('Gliederheizkörper: Leistung je Glied mal Gliederzahl ersetzt die Normleistung', () => {
  const g = (extra) => hk({ bauart: 'glieder', normleistung: null, ...extra });
  wahr(validiereHeizkoerper(g({ leistungJeGlied: 80, gliederzahl: 10 }), hkOptionen).length === 0, 'vollständig');
  wahr(hatWarnungen(validiereHeizkoerper(g({ leistungJeGlied: 80, gliederzahl: null }), hkOptionen)), 'ohne Gliederzahl fehlt die Leistung');
  wahr(hatFehler(validiereHeizkoerper(g({ leistungJeGlied: 80, gliederzahl: 2.5 }), hkOptionen)), 'Gliederzahl muss ganzzahlig sein');
});

test('Heizkörper: Normbedingungen müssen Vorlauf > Rücklauf > Raumtemperatur sein', () => {
  wahr(hatFehler(validiereHeizkoerper(hk({ normVorlauf: 65, normRuecklauf: 75 }), hkOptionen)), 'Vorlauf unter Rücklauf');
  wahr(hatFehler(validiereHeizkoerper(hk({ normRuecklauf: 20 }), hkOptionen)), 'Rücklauf gleich Raumtemperatur');
  wahr(hatFehler(validiereHeizkoerper(hk({ normVorlauf: null }), hkOptionen)), 'Bedingung fehlt');
  wahr(!hatFehler(validiereHeizkoerper(hk({ normVorlauf: 55, normRuecklauf: 45 }), hkOptionen)), '55/45/20 ist gültig');
});

test('Wärmepumpen-Heizkörper: mindestens zwei Wertepaare, Zeilenfehler blockieren', () => {
  const wp = (kennlinieText) => hk({ bauart: 'wp', normleistung: null, kennlinieText });
  wahr(validiereHeizkoerper(wp('35 600\n45 1000'), hkOptionen).length === 0, 'zwei Paare sind genug');
  const eins = validiereHeizkoerper(wp('35 600'), hkOptionen);
  wahr(feldMeldung(eins, 'kennlinieText', 'warnung') && !hatFehler(eins), 'ein Paar: Warnung "Leistung fehlt"');
  const leer = validiereHeizkoerper(wp(''), hkOptionen);
  wahr(feldMeldung(leer, 'kennlinieText', 'warnung'), 'ohne Paare: Warnung');
  wahr(hatFehler(validiereHeizkoerper(wp('35 600\nquatsch'), hkOptionen)), 'ungültige Zeile blockiert');
  wahr(hatFehler(validiereHeizkoerper(wp('35 600\n35 700'), hkOptionen)), 'doppelter Vorlauf blockiert');
});

test('Heizkörper: ungewöhnliche Werte werden markiert', () => {
  wahr(hatWarnungen(validiereHeizkoerper(hk({ exponent: 2.1 }), hkOptionen)), 'Exponent 2,1');
  wahr(hatWarnungen(validiereHeizkoerper(hk({ normleistung: 20000 }), hkOptionen)), 'Normleistung 20 kW');
  wahr(hatFehler(validiereHeizkoerper(hk({ bauhoehe: 0 }), hkOptionen)), 'Bauhöhe 0');
});

// --- Normbedingungen: Pflicht, keine Vorbelegung, Schnellwahl ---------------------------

import { neuerHeizkoerper, NORM_SCHNELLWAHL, normWahlVon, heizkoerperFelder } from '../js/schemas.js';

test('Neuer Heizkörper hat keine vorbelegten Normbedingungen und keine Leistung', () => {
  const neu = neuerHeizkoerper('raum');
  wahr(neu.normVorlauf === null && neu.normRuecklauf === null && neu.normRaum === null, 'Normbedingungen leer');
  wahr(neu.normleistung === null && neu.leistungJeGlied === null, 'keine Leistung vorbelegt');
  wahr(normWahlVon(neu) === '', 'keine Schnellwahl vorausgewählt');
});

test('Schnellwahl bietet 75/65/20, 70/55/20, 55/45/20, 90/70/20 und eigene Werte, ohne Vorauswahl', () => {
  wahr(NORM_SCHNELLWAHL.map((o) => o.wert).join('|') === '|75/65/20|70/55/20|55/45/20|90/70/20|eigen', 'Optionen und Reihenfolge');
  const feld = heizkoerperFelder().find((f) => f.key === 'normWahl');
  wahr(feld.fuellt.join() === 'normVorlauf,normRuecklauf,normRaum', 'füllt Vorlauf, Rücklauf und Raumtemperatur');
});

test('Gespeicherte Normbedingungen werden der Schnellwahl zugeordnet', () => {
  const mit = (v, r, ra) => normWahlVon({ normVorlauf: v, normRuecklauf: r, normRaum: ra });
  wahr(mit(55, 45, 20) === '55/45/20', '55/45/20');
  wahr(mit(90, 70, 20) === '90/70/20', '90/70/20');
  wahr(mit(60, 50, 20) === 'eigen', 'eigene Werte');
  wahr(mit(55, null, null) === 'eigen', 'unvollständig gilt als eigene Werte');
  wahr(mit(null, null, null) === '', 'leer');
});

test('Normbedingungen sind Pflicht: leer ergibt genau einen Fehler an der Schnellwahl', () => {
  const ohne = hk({ normVorlauf: null, normRuecklauf: null, normRaum: null });
  const meldungen = validiereHeizkoerper(ohne, hkOptionen);
  wahr(hatFehler(meldungen), 'Fehler erwartet');
  wahr(meldungen.filter((m) => m.stufe === 'fehler').length === 1, 'eine gebündelte Meldung statt drei einzelner');
  wahr(feldMeldung(meldungen, 'normWahl', 'fehler'), 'Meldung hängt an der Schnellwahl');
});

test('Gliederheizkörper braucht dieselben Pflichtfelder für die Bedingungen', () => {
  const glieder = (extra) => hk({ bauart: 'glieder', normleistung: null, leistungJeGlied: 80, gliederzahl: 10, ...extra });
  wahr(!hatFehler(validiereHeizkoerper(glieder({ normVorlauf: 90, normRuecklauf: 70, normRaum: 20 }), hkOptionen)), '90/70/20 ist gültig');
  wahr(hatFehler(validiereHeizkoerper(glieder({ normVorlauf: null, normRuecklauf: null, normRaum: null }), hkOptionen)), 'ohne Bedingungen blockiert');
  wahr(hatFehler(validiereHeizkoerper(glieder({ normRuecklauf: null }), hkOptionen)), 'teilweise leer blockiert');
});

test('Wärmepumpen-Heizkörper braucht keine Normbedingungen', () => {
  const wp = hk({ bauart: 'wp', normleistung: null, kennlinieText: '35 600\n45 1000', normVorlauf: null, normRuecklauf: null, normRaum: null });
  wahr(validiereHeizkoerper(wp, hkOptionen).length === 0, 'Kennlinie genügt');
});

// --- Verbrauchsabgleich ----------------------------------------------------------------

import { validiereVerbrauch } from '../js/validate.js';
import { neuerVerbrauch } from '../js/schemas.js';

const verbrauch = (extra = {}) => ({
  name: 'Heizperiode', gasKwh: 20000, nichtFuerHeizungKwh: 3000, kesselNutzungsgrad: { min: 90, max: 95 },
  holzRm: null, heizwertRm: null, ofenWirkungsgrad: null, innentemperaturIst: { min: 20, max: 21 }, innentemperaturSoll: 21,
  monate: [{ id: 'm1', name: 'Januar', gradtage: 650, heiztage: 31, heizmonat: true }], ...extra,
});

test('Neuer Verbrauchsabgleich: keine erfundenen Werte außer Nicht-Heizungs-Anteil 0 und dem Vorschlag für die Soll-Temperatur', () => {
  const neu = neuerVerbrauch(18.6);
  wahr(neu.gasKwh === null && neu.holzRm === null, 'Gas und Holz leer');
  wahr(neu.kesselNutzungsgrad.min === null && neu.kesselNutzungsgrad.max === null, 'Nutzungsgrad leer');
  wahr(neu.heizwertRm === null && neu.ofenWirkungsgrad === null, 'Heizwert und Wirkungsgrad leer');
  wahr(neu.nichtFuerHeizungKwh === 0 && neu.innentemperaturSoll === 18.6, 'Anteil 0, Soll-Temperatur ist der Vorschlag');
  wahr(neu.innentemperaturIst.min === null && neu.innentemperaturIst.max === null, 'tatsächliche Innentemperatur nicht vorbelegt');
  wahr(neu.monate.length === 0, 'keine Monate vorbelegt');
});

test('Verbrauchsabgleich: vollständige Angaben ohne Meldung', () => {
  wahr(validiereVerbrauch(verbrauch()).length === 0, 'keine Meldung erwartet');
});

test('Verbrauchsabgleich: Pflichtangaben fehlen', () => {
  wahr(hatFehler(validiereVerbrauch(verbrauch({ name: '' }))), 'Name');
  wahr(hatFehler(validiereVerbrauch(verbrauch({ gasKwh: null }))), 'Gas');
  wahr(hatFehler(validiereVerbrauch(verbrauch({ kesselNutzungsgrad: { min: null, max: null } }))), 'Nutzungsgrad');
  wahr(hatFehler(validiereVerbrauch(verbrauch({ innentemperaturIst: { min: null, max: null } }))), 'tatsächliche Innentemperatur ist Pflicht');
  wahr(hatFehler(validiereVerbrauch(verbrauch({ innentemperaturIst: { min: 21, max: 19 } }))), 'θ_ist: Minimum über Maximum');
  wahr(hatFehler(validiereVerbrauch(verbrauch({ innentemperaturSoll: null }))), 'Soll-Innentemperatur ist Pflicht');
  wahr(hatFehler(validiereVerbrauch(verbrauch({ kesselNutzungsgrad: { min: 95, max: 90 } }))), 'Minimum über Maximum');
  wahr(hatFehler(validiereVerbrauch(verbrauch({ nichtFuerHeizungKwh: 25000 }))), 'Anteil nicht für Heizung über Gas');
});

test('Verbrauchsabgleich: Holz verlangt Heizwert und Wirkungsgrad', () => {
  wahr(hatFehler(validiereVerbrauch(verbrauch({ holzRm: 4 }))), 'Holz ohne Heizwert');
  const komplett = verbrauch({ holzRm: 4, heizwertRm: { min: 1800, max: 2000 }, ofenWirkungsgrad: { min: 70, max: 80 } });
  wahr(validiereVerbrauch(komplett).length === 0, 'Holz vollständig');
  wahr(!hatFehler(validiereVerbrauch(verbrauch({ holzRm: 0 }))), '0 Rm braucht nichts');
});

test('Verbrauchsabgleich: Heizmonate wählen und vollständig ausfüllen', () => {
  wahr(hatFehler(validiereVerbrauch(verbrauch({ monate: [] }))), 'ohne Monate');
  const abgewaehlt = [{ id: 'm1', name: 'Januar', gradtage: 650, heiztage: 31, heizmonat: false }];
  wahr(feldMeldung(validiereVerbrauch(verbrauch({ monate: abgewaehlt })), 'monate', 'fehler'), 'kein Monat gewählt');
  const ohneG = [{ id: 'm1', name: 'Januar', gradtage: null, heiztage: 31, heizmonat: true }];
  const m = validiereVerbrauch(verbrauch({ monate: ohneG })).find((x) => x.feld === 'monate');
  wahr(m && m.monatId === 'm1' && m.text.includes('Januar'), 'Meldung nennt den Monat');
  const halbe = [{ id: 'm1', name: 'Januar', gradtage: 650, heiztage: 31.5, heizmonat: true }];
  wahr(hatFehler(validiereVerbrauch(verbrauch({ monate: halbe }))), 'Heiztage müssen ganzzahlig sein');
  const zuviele = [{ id: 'm1', name: 'Januar', gradtage: 650, heiztage: 40, heizmonat: true }];
  wahr(hatFehler(validiereVerbrauch(verbrauch({ monate: zuviele }))), 'mehr als 31 Heiztage');
});

test('Verbrauchsabgleich: nicht gewählte, unvollständige Monate stören nicht', () => {
  const monate = [
    { id: 'm1', name: 'Januar', gradtage: 650, heiztage: 31, heizmonat: true },
    { id: 'm2', name: 'Mai', gradtage: null, heiztage: null, heizmonat: false },
  ];
  wahr(validiereVerbrauch(verbrauch({ monate })).length === 0, 'Mai ist abgewählt');
});

test('Verbrauchsabgleich: ungewöhnliche Gradtage je Heiztag und nicht positive Gradtagzahl', () => {
  const viel = [{ id: 'm1', name: 'Januar', gradtage: 1500, heiztage: 31, heizmonat: true }];
  wahr(hatWarnungen(validiereVerbrauch(verbrauch({ monate: viel }))), '48 Kd je Tag ist ungewöhnlich');
  const wenig = [{ id: 'm1', name: 'Januar', gradtage: 100, heiztage: 10, heizmonat: true }];
  wahr(feldMeldung(validiereVerbrauch(verbrauch({ monate: wenig, innentemperaturIst: { min: 5, max: 6 } })), 'innentemperaturIst', 'fehler'), 'G nach Umrechnung nicht positiv (niedrigste tatsächliche Temperatur)');
});
