// Plausibilitätsprüfung. Reine Funktionen ohne Oberflächenbezug.
// Eingabe sind geparste Werte (Zahl, null bei leerem Feld, NaN bei unlesbarer Eingabe),
// Ausgabe ist eine Liste von { feld, stufe: 'fehler' | 'warnung', text }.
//
// Fehler verhindern das Speichern: die Eingabe ist unlesbar oder in sich widersprüchlich.
// Warnungen markieren unplausible Werte, sie lassen sich aber trotzdem speichern.

import { zahlZuText } from './engine/format.js';
import { parseKennlinie, normleistungVon } from './modell.js';

const fehler = (feld, text) => ({ feld, stufe: 'fehler', text });
const warnung = (feld, text) => ({ feld, stufe: 'warnung', text });
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const z = zahlZuText;

export const hatFehler = (meldungen) => meldungen.some((m) => m.stufe === 'fehler');
export const hatWarnungen = (meldungen) => meldungen.some((m) => m.stufe === 'warnung');

// Einzelne Zahl. Optionen: name, einheit, fehlerWennKleiner, fehlerWennKleinerGleich,
// warnWennUeber, warnWennUnter.
function zahl(feld, wert, opt) {
  const einheit = opt.einheit ? ` ${opt.einheit}` : '';
  if (!istZahl(wert)) return [fehler(feld, `${opt.name}: bitte eine Zahl eingeben.`)];
  if (opt.fehlerWennKleinerGleich !== undefined && wert <= opt.fehlerWennKleinerGleich) {
    return [fehler(feld, `${opt.name} muss größer als ${z(opt.fehlerWennKleinerGleich)}${einheit} sein.`)];
  }
  if (opt.fehlerWennKleiner !== undefined && wert < opt.fehlerWennKleiner) {
    return [fehler(feld, `${opt.name} darf nicht kleiner als ${z(opt.fehlerWennKleiner)}${einheit} sein.`)];
  }
  if (opt.warnWennUeber !== undefined && wert > opt.warnWennUeber) {
    return [warnung(feld, `${opt.name} von ${z(wert)}${einheit} ist ungewöhnlich hoch (üblich bis ${z(opt.warnWennUeber)}).`)];
  }
  if (opt.warnWennUnter !== undefined && wert < opt.warnWennUnter) {
    return [warnung(feld, `${opt.name} von ${z(wert)}${einheit} ist ungewöhnlich niedrig (üblich ab ${z(opt.warnWennUnter)}).`)];
  }
  return [];
}

// Bereich { min, max }: beide Werte einzeln prüfen, dann Reihenfolge.
function bereich(feld, wert, opt) {
  const meldungen = [
    ...zahl(feld, wert?.min, { ...opt, name: `${opt.name} (min)` }),
    ...zahl(feld, wert?.max, { ...opt, name: `${opt.name} (max)` }),
  ];
  if (istZahl(wert?.min) && istZahl(wert?.max) && wert.min > wert.max) {
    meldungen.push(fehler(feld, `${opt.name}: der Minimalwert darf nicht größer als der Maximalwert sein.`));
  }
  return meldungen;
}

function pflichtText(feld, wert, name) {
  return typeof wert === 'string' && wert.trim() !== '' ? [] : [fehler(feld, `${name}: bitte einen Namen eingeben.`)];
}

function ausListe(feld, wert, erlaubt, name) {
  return erlaubt.includes(wert) ? [] : [fehler(feld, `${name}: bitte eine Auswahl treffen.`)];
}

export function validiereEinstellungen(e) {
  return [
    ...zahl('thetaAussen', e.thetaAussen, {
      name: 'Normaußentemperatur', einheit: '°C', warnWennUeber: 0, warnWennUnter: -25,
    }),
    ...bereich('luftwechselStandard', e.luftwechselStandard, {
      name: 'Luftwechsel', einheit: '1/h', fehlerWennKleiner: 0, warnWennUeber: 3,
    }),
    ...bereich('dUWB', e.dUWB, {
      name: 'Wärmebrückenzuschlag', einheit: 'W/(m²K)', fehlerWennKleiner: 0, warnWennUeber: 0.3,
    }),
    ...zahl('fg', e.fg, { name: 'Erdreich-Korrekturfaktor', fehlerWennKleinerGleich: 0, warnWennUeber: 1.5 }),
    ...zahl('aufheizzuschlag.wProM2', e.aufheizzuschlag?.wProM2, {
      name: 'Aufheizzuschlag', einheit: 'W/m²', fehlerWennKleiner: 0, warnWennUeber: 40,
    }),
    ...zahl('spreizung', e.spreizung, {
      name: 'Spreizung', einheit: 'K', fehlerWennKleinerGleich: 0, warnWennUeber: 20,
    }),
    ...zahl('heizkoerperExponent', e.heizkoerperExponent, {
      name: 'Heizkörperexponent', fehlerWennKleinerGleich: 0, warnWennUeber: 1.6, warnWennUnter: 1,
    }),
  ];
}

export function validiereZone(zone, erlaubteArten) {
  const meldungen = [
    ...pflichtText('name', zone.name, 'Zone'),
    ...ausListe('art', zone.art, erlaubteArten, 'Art der Zone'),
    ...bereich('temperatur', zone.temperatur, {
      name: 'Temperatur', einheit: '°C', warnWennUeber: 45, warnWennUnter: -30,
    }),
  ];
  if (zone.art === 'erdreich' && istZahl(zone.temperatur?.min) && istZahl(zone.temperatur?.max)) {
    if (zone.temperatur.min < 0 || zone.temperatur.max > 20) {
      meldungen.push(warnung('temperatur', 'Erdreichtemperaturen liegen üblicherweise zwischen 0 und 20 °C.'));
    }
  }
  return meldungen;
}

export function validiereBauteil(bauteil, erlaubteArten, erlaubteQuellen) {
  return [
    ...pflichtText('name', bauteil.name, 'Bauteil'),
    ...ausListe('art', bauteil.art, erlaubteArten, 'Bauteilart'),
    ...bereich('u', bauteil.u, {
      name: 'U-Wert', einheit: 'W/(m²K)', fehlerWennKleinerGleich: 0, warnWennUeber: 6, warnWennUnter: 0.05,
    }),
    ...ausListe('quelle', bauteil.quelle, erlaubteQuellen, 'Quelle des Werts'),
  ];
}

export function validiereOeffnungstyp(typ, erlaubteArten, erlaubteQuellen) {
  return [
    ...pflichtText('name', typ.name, 'Öffnung'),
    ...ausListe('art', typ.art, erlaubteArten, 'Art der Öffnung'),
    ...zahl('uw', typ.uw, {
      name: 'Uw-Wert', einheit: 'W/(m²K)', fehlerWennKleinerGleich: 0, warnWennUeber: 6, warnWennUnter: 0.3,
    }),
    ...ausListe('quelle', typ.quelle, erlaubteQuellen, 'Quelle des Werts'),
  ];
}

// Räume kommen in Schritt 3 in die Oberfläche. Die Regeln liegen schon hier,
// damit sie getestet sind: Fläche 0 und Raumhöhe über 6 m werden markiert.
export function validiereRaum(raum) {
  const meldungen = [...pflichtText('name', raum.name, 'Raum')];

  meldungen.push(...zahl('flaeche', raum.flaeche, { name: 'Fläche', einheit: 'm²', fehlerWennKleiner: 0, warnWennUeber: 100 }));
  if (raum.flaeche === 0) meldungen.push(warnung('flaeche', 'Fläche ist 0 m². Bitte prüfen.'));

  meldungen.push(...zahl('hoehe', raum.hoehe, { name: 'Lichte Höhe', einheit: 'm', fehlerWennKleiner: 0, warnWennUeber: 6 }));
  if (raum.hoehe === 0) meldungen.push(warnung('hoehe', 'Lichte Höhe ist 0 m. Bitte prüfen.'));

  meldungen.push(...zahl('theta', raum.theta, {
    name: 'Soll-Temperatur', einheit: '°C', warnWennUeber: 30, warnWennUnter: 5,
  }));
  if (raum.luftwechsel) {
    meldungen.push(...bereich('luftwechsel', raum.luftwechsel, {
      name: 'Luftwechsel', einheit: '1/h', fehlerWennKleiner: 0, warnWennUeber: 3,
    }));
  }
  return meldungen;
}

// Raummaske: Zahlenregeln aus validiereRaum plus Status, Geschoss und manuelles Volumen.
// Eine unbeheizte Zone braucht keine Soll-Temperatur.
export function validiereRaumEingabe(raum, { stati, geschosse }) {
  const ohneTemperatur = raum.status === 'unbeheizt' && (raum.theta === null || raum.theta === undefined);
  const meldungen = validiereRaum(ohneTemperatur ? { ...raum, theta: 20 } : raum);
  meldungen.push(
    ...ausListe('status', raum.status, stati, 'Status'),
    ...ausListe('geschoss', raum.geschoss, geschosse, 'Geschoss'),
  );
  if (raum.volumenManuell !== null && raum.volumenManuell !== undefined) {
    meldungen.push(...zahl('volumenManuell', raum.volumenManuell, {
      name: 'Volumen', einheit: 'm³', fehlerWennKleinerGleich: 0, warnWennUeber: 500,
    }));
  }
  return meldungen;
}

const MASSARTEN = ['laengeHoehe', 'flaeche'];

// Maße als Länge × Höhe oder direkte Fläche. Null wird markiert, negative Werte blockieren.
function masse(eintrag, grenzen) {
  const meldungen = [...ausListe('modus', eintrag.modus, MASSARTEN, 'Maße')];
  const nullWarnung = (feld, wert, name) => (wert === 0 ? [warnung(feld, `${name} ist 0. Bitte prüfen.`)] : []);
  if (eintrag.modus === 'flaeche') {
    meldungen.push(
      ...zahl('flaeche', eintrag.flaeche, { name: 'Fläche', einheit: 'm²', fehlerWennKleiner: 0, warnWennUeber: grenzen.flaecheMax }),
      ...nullWarnung('flaeche', eintrag.flaeche, 'Fläche'),
    );
  } else {
    meldungen.push(
      ...zahl('laenge', eintrag.laenge, { name: grenzen.laengeName, einheit: 'm', fehlerWennKleiner: 0, warnWennUeber: grenzen.laengeMax }),
      ...nullWarnung('laenge', eintrag.laenge, grenzen.laengeName),
      ...zahl('hoehe', eintrag.hoehe, { name: 'Höhe', einheit: 'm', fehlerWennKleiner: 0, warnWennUeber: grenzen.hoeheMax }),
      ...nullWarnung('hoehe', eintrag.hoehe, 'Höhe'),
    );
  }
  return meldungen;
}

// Raumfläche: Bauteil aus dem Katalog, Gegenseite und Maße.
export function validiereFlaeche(flaeche, { bauteilIds, angrenzendWerte }) {
  return [
    ...(bauteilIds.includes(flaeche.bauteilId) ? [] : [fehler('bauteilId', 'Bauteil: bitte ein Bauteil aus dem Katalog wählen.')]),
    ...ausListe('angrenzendWahl', flaeche.angrenzendWahl, angrenzendWerte, 'Grenzt an'),
    ...masse(flaeche, { laengeName: 'Länge', laengeMax: 30, hoeheMax: 6, flaecheMax: 150 }),
  ];
}

// Öffnung in einer Raumfläche: Typ aus dem Katalog, Maße und Anzahl (ganze Zahl ab 1).
export function validiereOeffnungEintrag(oeffnung, { typIds }) {
  const meldungen = [
    ...(typIds.includes(oeffnung.typId) ? [] : [fehler('typId', 'Öffnungstyp: bitte einen Typ aus dem Katalog wählen.')]),
    ...masse(oeffnung, { laengeName: 'Breite', laengeMax: 6, hoeheMax: 4, flaecheMax: 15 }),
    ...zahl('anzahl', oeffnung.anzahl, { name: 'Anzahl', fehlerWennKleiner: 1, warnWennUeber: 20 }),
  ];
  if (istZahl(oeffnung.anzahl) && !Number.isInteger(oeffnung.anzahl)) {
    meldungen.push(fehler('anzahl', 'Anzahl: bitte eine ganze Zahl eingeben.'));
  }
  return meldungen;
}

// Heizkörper. Eine fehlende Leistung ist kein Fehler: der Heizkörper lässt sich speichern, gilt
// dann aber als "Leistung fehlt" und bekommt keine Vorlauftemperatur. Das erscheint als Warnung.
export function validiereHeizkoerper(h, { bauarten, stati, ventile }) {
  const meldungen = [
    ...ausListe('bauart', h.bauart, bauarten, 'Bauart'),
    ...ausListe('status', h.status, stati, 'Status'),
    ...ausListe('ventil', h.ventil, ventile, 'Ventil'),
  ];
  const optional = (feld, wert, opt) => (wert === null || wert === undefined ? [] : zahl(feld, wert, opt));

  meldungen.push(
    ...optional('bauhoehe', h.bauhoehe, { name: 'Bauhöhe', einheit: 'mm', fehlerWennKleinerGleich: 0, warnWennUeber: 3000 }),
    ...optional('baulaenge', h.baulaenge, { name: 'Baulänge', einheit: 'mm', fehlerWennKleinerGleich: 0, warnWennUeber: 5000 }),
    ...optional('bautiefe', h.bautiefe, { name: 'Bautiefe', einheit: 'mm', fehlerWennKleinerGleich: 0, warnWennUeber: 400 }),
    ...optional('nabenabstand', h.nabenabstand, { name: 'Nabenabstand', einheit: 'mm', fehlerWennKleinerGleich: 0, warnWennUeber: 2500 }),
    ...optional('gliederzahl', h.gliederzahl, { name: 'Gliederzahl', fehlerWennKleiner: 1, warnWennUeber: 60 }),
  );
  if (istZahl(h.gliederzahl) && !Number.isInteger(h.gliederzahl)) {
    meldungen.push(fehler('gliederzahl', 'Gliederzahl: bitte eine ganze Zahl eingeben.'));
  }

  if (h.bauart === 'wp') {
    const kennlinie = parseKennlinie(h.kennlinieText);
    for (const f of kennlinie.fehler) meldungen.push(fehler('kennlinieText', `Zeile ${f.zeile}: ${f.text}`));
    if (kennlinie.fehler.length === 0 && kennlinie.paare.length < 2) {
      meldungen.push(warnung('kennlinieText', 'Leistung fehlt: Mindestens zwei Wertepaare nötig. Bis dahin gibt es keine Vorlauftemperatur für diesen Raum.'));
    }
    if (kennlinie.paare.length > 0) {
      meldungen.push(...zahl('kennlinieRaumtemperatur', h.kennlinieRaumtemperatur, {
        name: 'Raumtemperatur laut Datenblatt', einheit: '°C', warnWennUeber: 30, warnWennUnter: 10,
      }));
    }
    return meldungen;
  }

  meldungen.push(
    ...optional('leistungJeGlied', h.leistungJeGlied, { name: 'Leistung je Glied', einheit: 'W', fehlerWennKleinerGleich: 0, warnWennUeber: 400 }),
    ...optional('normleistung', h.normleistung, { name: 'Normleistung', einheit: 'W', fehlerWennKleinerGleich: 0, warnWennUeber: 8000 }),
    ...optional('exponent', h.exponent, { name: 'Heizkörperexponent', fehlerWennKleinerGleich: 0, warnWennUeber: 1.6, warnWennUnter: 1 }),
  );

  // Normbedingungen: Vorlauf über Rücklauf über Raumtemperatur.
  for (const [feld, name] of [['normVorlauf', 'Vorlauf'], ['normRuecklauf', 'Rücklauf'], ['normRaum', 'Raumtemperatur']]) {
    meldungen.push(...zahl(feld, h[feld], { name: `Normbedingung ${name}`, einheit: '°C', warnWennUeber: 100, warnWennUnter: 0 }));
  }
  if ([h.normVorlauf, h.normRuecklauf, h.normRaum].every(istZahl) && !(h.normVorlauf > h.normRuecklauf && h.normRuecklauf > h.normRaum)) {
    meldungen.push(fehler('normRuecklauf', 'Normbedingungen: der Vorlauf muss über dem Rücklauf liegen und der Rücklauf über der Raumtemperatur.'));
  }

  if (normleistungVon(h) === null) {
    meldungen.push(warnung(
      'normleistung',
      h.bauart === 'glieder'
        ? 'Leistung fehlt: Normleistung oder Leistung je Glied mit Gliederzahl eintragen. Bis dahin gibt es keine Vorlauftemperatur für diesen Raum.'
        : 'Leistung fehlt: Bis zur Eingabe der Normleistung gibt es keine Vorlauftemperatur für diesen Raum.',
    ));
  }
  return meldungen;
}
