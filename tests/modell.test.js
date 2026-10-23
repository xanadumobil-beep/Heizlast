// Tests für die Umrechnung gespeicherter Daten in die Eingabe des Rechenkerns.
// Die Zahlen stammen aus den Handrechnungen A und E in engine.test.js.

import { test, gleich, wahr } from './runner.js';
import {
  flaecheAusMassen, nettoFlaeche, oeffnungsGesamtflaeche, raumVolumen,
  wahlZuAngrenzend, angrenzendZuWahl, baueRechenEingabe,
} from '../js/modell.js';
import { berechneGebaeude } from '../js/engine/heatload.js';

const einstellungen = {
  thetaAussen: -8,
  dUWB: { min: 0.1, max: 0.1 },
  fg: 1,
  luftwechselStandard: { min: 0.5, max: 0.5 },
  aufheizzuschlag: { aktiv: false, wProM2: 0 },
};

test('Fläche aus Länge × Höhe und aus direkter Fläche', () => {
  gleich(flaecheAusMassen({ modus: 'laengeHoehe', laenge: 4, hoehe: 2.5 }), 10, 1e-9, 'Länge × Höhe');
  gleich(flaecheAusMassen({ modus: 'flaeche', flaeche: 7.5 }), 7.5, 1e-9, 'direkt');
  wahr(Number.isNaN(flaecheAusMassen({ modus: 'laengeHoehe', laenge: 4, hoehe: null })), 'fehlende Höhe ergibt NaN');
});

// Wand 4,00 × 2,50 = 10,00 m². Öffnung: 2 Stück à 1,20 × 0,70 = 0,84 m², zusammen 1,68 m².
// Nettofläche 10,00 − 1,68 = 8,32 m².
test('Öffnungen werden automatisch von der Raumfläche abgezogen', () => {
  const wand = {
    modus: 'laengeHoehe', laenge: 4, hoehe: 2.5,
    oeffnungen: [{ typId: 'f', modus: 'laengeHoehe', laenge: 1.2, hoehe: 0.7, anzahl: 2 }],
  };
  gleich(oeffnungsGesamtflaeche(wand.oeffnungen[0]), 1.68, 1e-9, 'Öffnungsfläche');
  gleich(nettoFlaeche(wand), 8.32, 1e-9, 'Nettofläche');
});

test('Volumen: Fläche × Höhe oder manueller Wert', () => {
  gleich(raumVolumen({ flaeche: 16, hoehe: 2.5, volumenManuell: null }), 40, 1e-9, 'berechnet');
  gleich(raumVolumen({ flaeche: 16, hoehe: 2.5, volumenManuell: 38 }), 38, 1e-9, 'manuell');
});

test('Auswahlwert und Gegenseite wandeln sich ineinander um', () => {
  for (const wahl of ['aussen', 'zone:z1', 'raum:r1']) {
    wahr(angrenzendZuWahl(wahlZuAngrenzend(wahl)) === wahl, `Rundlauf ${wahl}`);
  }
  wahr(wahlZuAngrenzend('zone:z1').zoneId === 'z1', 'Zonen-ID');
  wahr(wahlZuAngrenzend('quatsch') === null, 'unbekannter Wert');
});

// Bad (22 °C) und R1 (20 °C) wie in Beispiel E, diesmal aus gespeicherten Daten aufgebaut:
// Bad 295,50 W (darin 24,00 W Raum-zu-Raum), R1 498,40 W, Gebäudesumme 769,90 W.
function projektE() {
  return {
    einstellungen,
    zonen: [],
    bauteile: [
      { id: 'aw-bad', name: 'Außenwand Bad', art: 'aussenwand', u: { min: 1.2, max: 1.2 } },
      { id: 'aw-r1', name: 'Außenwand R1', art: 'aussenwand', u: { min: 1.0, max: 1.0 } },
      { id: 'iw', name: 'Innenwand', art: 'innenwand', u: { min: 1.5, max: 1.5 } },
    ],
    oeffnungstypen: [],
    raeume: [
      { id: 'bad', name: 'Bad', status: 'beheizt', theta: 22, flaeche: 6, hoehe: 2.5, volumenManuell: null },
      { id: 'r1', name: 'R1', status: 'beheizt', theta: 20, flaeche: 16, hoehe: 2.5, volumenManuell: null },
    ],
    flaechen: [
      { id: 'bad-aussen', raumId: 'bad', bauteilId: 'aw-bad', angrenzend: { art: 'aussen' }, modus: 'flaeche', flaeche: 5 },
      { id: 'bad-r1', raumId: 'bad', bauteilId: 'iw', angrenzend: { art: 'raum', raumId: 'r1' }, modus: 'flaeche', flaeche: 8 },
      {
        id: 'r1-aussen', raumId: 'r1', bauteilId: 'aw-r1', angrenzend: { art: 'aussen' },
        modus: 'laengeHoehe', laenge: 4, hoehe: 2.5,
      },
    ],
  };
}

test('Aus gespeicherten Daten gebaut: Beispiel E ergibt dieselben Zahlen', () => {
  const { eingabe, hinweise } = baueRechenEingabe(projektE());
  const ergebnis = berechneGebaeude(eingabe);
  gleich(ergebnis.raeume[0].guenstig.heizlast, 295.50, 0.01, 'Bad');
  gleich(ergebnis.raeume[0].guenstig.raumZuRaumSumme, 24.00, 0.001, 'Bad Raum-zu-Raum');
  gleich(ergebnis.raeume[1].guenstig.heizlast, 498.40, 0.01, 'R1');
  gleich(ergebnis.gebaeude.guenstig.summe, 769.90, 0.01, 'Gebäudesumme');
  gleich(ergebnis.gebaeude.guenstig.differenz, 0, 0.001, 'Differenz');
  // R1 führt keine Fläche zum wärmeren Bad, Bad führt aber eine zu R1: kein Hinweis nötig.
  wahr(hinweise.length === 0, `unerwartete Hinweise: ${JSON.stringify(hinweise)}`);
});

// Beispiel A aus gespeicherten Daten: Wand 4,00 × 2,50 m, 2 Fenster à 1,20 × 0,70 m, Uw = 1,3, U_Wand = 1,2.
//   Wand:    (10,00 − 1,68) · (1,2 + 0,1) · 28 = 302,85 W
//   Fenster: 1,68 · (1,3 + 0,1) · 28            =  65,86 W
test('Aus gespeicherten Daten gebaut: Beispiel A mit Öffnungen', () => {
  const { eingabe, hinweise } = baueRechenEingabe({
    einstellungen,
    zonen: [],
    bauteile: [{ id: 'aw', name: 'Außenwand', art: 'aussenwand', u: { min: 1.2, max: 1.2 } }],
    oeffnungstypen: [{ id: 'f', name: 'Fenster', art: 'fenster', uw: 1.3 }],
    raeume: [{ id: 'a', name: 'A', status: 'beheizt', theta: 20, flaeche: 10, hoehe: 0, volumenManuell: 0, luftwechsel: { min: 0, max: 0 } }],
    flaechen: [{
      id: 'w', raumId: 'a', bauteilId: 'aw', angrenzend: { art: 'aussen' }, modus: 'laengeHoehe', laenge: 4, hoehe: 2.5,
      oeffnungen: [{ typId: 'f', modus: 'laengeHoehe', laenge: 1.2, hoehe: 0.7, anzahl: 2 }],
    }],
  });
  const raum = berechneGebaeude(eingabe).raeume[0].guenstig;
  gleich(raum.wand, 302.85, 0.01, 'Wand');
  gleich(raum.oeffnungen, 65.86, 0.01, 'Fenster');
  wahr(hinweise.length === 0, 'keine Hinweise erwartet');
});

test('Hinweis, wenn ein Bauteil fehlt: Fläche wird ausgelassen, Rechnung läuft weiter', () => {
  const projekt = projektE();
  projekt.bauteile = projekt.bauteile.filter((b) => b.id !== 'iw');
  const { eingabe, hinweise } = baueRechenEingabe(projekt);
  wahr(hinweise.some((h) => h.art === 'bauteil_fehlt' && h.flaecheId === 'bad-r1'), 'Hinweis fehlt');
  gleich(berechneGebaeude(eingabe).raeume[0].guenstig.heizlast, 271.50, 0.01, 'Bad ohne die Innenwand');
});

test('Hinweis, wenn die Öffnungen größer sind als die Fläche', () => {
  const projekt = projektE();
  projekt.oeffnungstypen = [{ id: 'f', name: 'Fenster', art: 'fenster', uw: 1.3 }];
  projekt.flaechen[0].oeffnungen = [{ typId: 'f', modus: 'flaeche', flaeche: 6, anzahl: 1 }];
  const { hinweise } = baueRechenEingabe(projekt);
  wahr(hinweise.some((h) => h.art === 'oeffnungen_zu_gross' && h.flaecheId === 'bad-aussen'), 'Hinweis fehlt');
});

test('Hinweis, wenn eine Zone gelöscht wurde', () => {
  const projekt = projektE();
  projekt.flaechen[0].angrenzend = { art: 'zone', zoneId: 'weg' };
  const { hinweise } = baueRechenEingabe(projekt);
  wahr(hinweise.some((h) => h.art === 'zone_fehlt'), 'Hinweis fehlt');
});

test('Unvollständiger Raum wird nicht gerechnet und gemeldet', () => {
  const projekt = projektE();
  projekt.raeume[1].flaeche = null;
  const { eingabe, hinweise } = baueRechenEingabe(projekt);
  wahr(hinweise.some((h) => h.art === 'raum_unvollstaendig' && h.raumId === 'r1'), 'Hinweis fehlt');
  wahr(berechneGebaeude(eingabe).raeume.every((r) => r.id !== 'r1'), 'R1 darf nicht gerechnet werden');
});

// R1 (kälter) führt eine Wand zum Bad (wärmer), das Bad führt keine zu R1:
// der Verlust des Bades an R1 ginge verloren, deshalb gibt es einen Hinweis.
test('Hinweis, wenn der wärmere Raum die Gegenseite nicht führt', () => {
  const projekt = projektE();
  projekt.flaechen = projekt.flaechen.filter((f) => f.id !== 'bad-r1');
  projekt.flaechen.push({
    id: 'r1-bad', raumId: 'r1', bauteilId: 'iw', angrenzend: { art: 'raum', raumId: 'bad' }, modus: 'flaeche', flaeche: 8,
  });
  const { hinweise } = baueRechenEingabe(projekt);
  wahr(hinweise.some((h) => h.art === 'gegenseite_fehlt' && h.raumId === 'r1' && h.nachbarId === 'bad'), 'Hinweis fehlt');
});

// --- Stabile Kennungen -----------------------------------------------------------------

import { mitStabilenIds, doppelteIds } from '../js/modell.js';

const zaehlerId = () => {
  let n = 0;
  return () => `neu-${++n}`;
};

test('Öffnungen ohne ID bekommen eine, vorhandene IDs bleiben unverändert', () => {
  const flaeche = { id: 'f1', oeffnungen: [{ id: 'o-alt' }, { typId: 't' }] };
  const ergebnis = mitStabilenIds('surfaces', flaeche, zaehlerId());
  wahr(ergebnis.oeffnungen[0].id === 'o-alt', 'vorhandene ID bleibt');
  wahr(ergebnis.oeffnungen[1].id === 'neu-1', 'fehlende ID wird ergänzt');
});

test('Stabile IDs: zweites Speichern ändert nichts (idempotent), Export und Import erhalten sie', () => {
  const einmal = mitStabilenIds('surfaces', { id: 'f1', oeffnungen: [{ typId: 't' }, { typId: 't' }] }, zaehlerId());
  const zweimal = mitStabilenIds('surfaces', einmal, zaehlerId());
  wahr(zweimal === einmal, 'Objekt bleibt unverändert, wenn alle IDs da sind');
  const ausJson = JSON.parse(JSON.stringify(einmal));
  wahr(ausJson.oeffnungen.map((o) => o.id).join() === einmal.oeffnungen.map((o) => o.id).join(), 'IDs überstehen JSON');
  wahr(new Set(einmal.oeffnungen.map((o) => o.id)).size === 2, 'IDs sind eindeutig');
});

test('Doppelte ID innerhalb einer Fläche: die zweite bekommt eine neue', () => {
  const ergebnis = mitStabilenIds('surfaces', { id: 'f1', oeffnungen: [{ id: 'x' }, { id: 'x' }] }, zaehlerId());
  wahr(ergebnis.oeffnungen[0].id === 'x' && ergebnis.oeffnungen[1].id === 'neu-1', 'erste bleibt, zweite wird ersetzt');
});

test('Heizkörper behalten ihre ID, ohne ID bekommen sie eine', () => {
  wahr(mitStabilenIds('radiators', { id: 'hk-1' }, zaehlerId()).id === 'hk-1', 'vorhandene ID');
  wahr(mitStabilenIds('radiators', { raumId: 'r' }, zaehlerId()).id === 'neu-1', 'neue ID');
});

test('Doppelte IDs im Projekt werden gefunden (Öffnungen aller Flächen, Heizkörper)', () => {
  const flaechen = [{ id: 'a', oeffnungen: [{ id: 'o1' }] }, { id: 'b', oeffnungen: [{ id: 'o1' }, { id: 'o2' }] }];
  const doppelt = doppelteIds({ flaechen, heizkoerper: [{ id: 'h1' }, { id: 'h1' }, { id: 'h2' }] });
  wahr(doppelt.includes('oeffnung:o1') && doppelt.includes('heizkoerper:h1'), 'beide Dopplungen gefunden');
  wahr(doppelt.length === 2, 'sonst nichts');
});
