// Plausibilitätsprüfung. Reine Funktionen ohne Oberflächenbezug.
// Eingabe sind geparste Werte (Zahl, null bei leerem Feld, NaN bei unlesbarer Eingabe),
// Ausgabe ist eine Liste von { feld, stufe: 'fehler' | 'warnung', text }.
//
// Fehler verhindern das Speichern: die Eingabe ist unlesbar oder in sich widersprüchlich.
// Warnungen markieren unplausible Werte, sie lassen sich aber trotzdem speichern.

import { zahlZuText } from './engine/format.js';
import { parseKennlinie, normleistungVon } from './modell.js';
import { gradtage } from './engine/verbrauch.js';
import { fehlendeWerte } from './geraete.js';

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
    // Ziel-Vorlauf und Sperrzeit stehen erst seit dem Formular „Rechenannahmen“ in der Prüfung. Fehlt das Feld ganz, bleibt es unbeachtet.
    ...('zielVorlauf' in e ? zahl('zielVorlauf', e.zielVorlauf, { name: 'Ziel-Vorlauftemperatur', einheit: '°C', fehlerWennKleiner: 25, warnWennUeber: 60 }).concat(e.zielVorlauf > 75 ? [fehler('zielVorlauf', 'Ziel-Vorlauftemperatur: höchstens 75 °C.')] : []) : []),
    ...(e.waermepumpe?.sperrstunden === null || e.waermepumpe?.sperrstunden === undefined ? []
      : zahl('waermepumpe.sperrstunden', e.waermepumpe.sperrstunden, { name: 'Sperrzeit', einheit: 'h pro Tag', fehlerWennKleiner: 0 })
        .concat(e.waermepumpe.sperrstunden >= 24 ? [fehler('waermepumpe.sperrstunden', 'Sperrzeit: muss unter 24 h pro Tag liegen.')] : [])),
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

  // Normbedingungen sind Pflicht und nicht vorbelegt: die Leistung hängt stark davon ab (dieselbe Zahl
  // bei 75/65/20 statt 55/45/20 wäre rund doppelt so viel). Vorlauf über Rücklauf über Raumtemperatur.
  const bedingungen = [['normVorlauf', 'Vorlauf'], ['normRuecklauf', 'Rücklauf'], ['normRaum', 'Raumtemperatur']];
  if (bedingungen.every(([feld]) => h[feld] === null || h[feld] === undefined)) {
    meldungen.push(fehler(
      'normWahl',
      'Normbedingungen: bitte eine Schnellwahl treffen oder eigene Werte eintragen. Sie sind nicht vorbelegt, weil die Leistung stark davon abhängt.',
    ));
  } else {
    for (const [feld, name] of bedingungen) {
      meldungen.push(...zahl(feld, h[feld], { name: `Normbedingung ${name}`, einheit: '°C', warnWennUeber: 100, warnWennUnter: 0 }));
    }
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

// Verbrauchsabgleich. Meldungen zu den Monaten tragen feld 'monate' und, wenn sie einen Monat betreffen, monatId.
export function validiereVerbrauch(v) {
  const meldungen = [
    ...pflichtText('name', v.name, 'Verbrauchsabgleich'),
    ...zahl('gasKwh', v.gasKwh, { name: 'Gasverbrauch', einheit: 'kWh', fehlerWennKleiner: 0, warnWennUeber: 100000 }),
    ...zahl('nichtFuerHeizungKwh', v.nichtFuerHeizungKwh, { name: 'Anteil nicht für Heizung', einheit: 'kWh', fehlerWennKleiner: 0 }),
    ...bereich('kesselNutzungsgrad', v.kesselNutzungsgrad, {
      name: 'Kesselnutzungsgrad', einheit: '%', fehlerWennKleinerGleich: 0, warnWennUeber: 100, warnWennUnter: 50,
    }),
    ...bereich('innentemperaturIst', v.innentemperaturIst, {
      name: 'Tatsächliche Innentemperatur', einheit: '°C', warnWennUeber: 25, warnWennUnter: 15,
    }),
    ...zahl('innentemperaturSoll', v.innentemperaturSoll, { name: 'Soll-Innentemperatur', einheit: '°C', warnWennUeber: 25, warnWennUnter: 15 }),
  ];
  if (istZahl(v.gasKwh) && istZahl(v.nichtFuerHeizungKwh) && v.nichtFuerHeizungKwh > v.gasKwh) {
    meldungen.push(fehler('nichtFuerHeizungKwh', 'Der Anteil nicht für Heizung darf nicht größer sein als der Gasverbrauch.'));
  }
  if (istZahl(v.kesselNutzungsgrad?.max) && v.kesselNutzungsgrad.max > 100) {
    meldungen.push(warnung('kesselNutzungsgrad', `Der Nutzungsgrad liegt über 100 %. ${'Bezogen auf Brennwert Hs, wie in der Gasrechnung'} sind Werte über 100 % unüblich.`));
  }

  // Holz: Menge optional, Heizwert und Wirkungsgrad dann Pflicht.
  const holzGesetzt = v.holzRm !== null && v.holzRm !== undefined;
  if (holzGesetzt) meldungen.push(...zahl('holzRm', v.holzRm, { name: 'Holzmenge', einheit: 'Rm', fehlerWennKleiner: 0, warnWennUeber: 30 }));
  const mitHolz = istZahl(v.holzRm) && v.holzRm > 0;
  for (const [feld, name, einheit, warnUeber, warnUnter] of [
    ['heizwertRm', 'Heizwert', 'kWh/Rm', 2600, 800],
    ['ofenWirkungsgrad', 'Wirkungsgrad Kaminofen', '%', 90, 40],
  ]) {
    if (v[feld]) {
      meldungen.push(...bereich(feld, v[feld], { name, einheit, fehlerWennKleinerGleich: 0, warnWennUeber: warnUeber, warnWennUnter: warnUnter }));
    } else if (mitHolz) {
      meldungen.push(fehler(feld, `${name}: bitte Minimum und Maximum eintragen, weil Holz angegeben ist.`));
    }
  }

  // Heizmonate mit Gradtagzahl G20/15 und Heiztagen.
  const monate = v.monate ?? [];
  const gewaehlt = monate.filter((m) => m.heizmonat);
  let monateOk = true;
  if (gewaehlt.length === 0) {
    meldungen.push(fehler('monate', 'Bitte mindestens einen Heizmonat wählen und Gradtagzahl G20/15 und Heiztage eintragen.'));
    monateOk = false;
  }
  for (const m of gewaehlt) {
    const name = `Monat „${m.name || 'ohne Namen'}“`;
    const gOk = istZahl(m.gradtage) && m.gradtage > 0;
    const tOk = istZahl(m.heiztage) && Number.isInteger(m.heiztage) && m.heiztage >= 1 && m.heiztage <= 31;
    if (!gOk) meldungen.push({ ...fehler('monate', `${name}: bitte die Gradtagzahl G20/15 eintragen (größer als 0).`), monatId: m.id });
    if (!tOk) meldungen.push({ ...fehler('monate', `${name}: bitte die Heiztage als ganze Zahl von 1 bis 31 eintragen.`), monatId: m.id });
    if (!gOk || !tOk) {
      monateOk = false;
    } else if (m.gradtage / m.heiztage > 30 || m.gradtage / m.heiztage < 1) {
      meldungen.push({ ...warnung('monate', `${name}: ${zahlZuText(Math.round((m.gradtage / m.heiztage) * 10) / 10)} Kd je Heiztag ist ungewöhnlich. Bitte Gradtagzahl und Heiztage prüfen.`), monatId: m.id });
    }
  }

  // Nach der Umrechnung auf die Innentemperatur muss die Gradtagzahl positiv bleiben.
  // Der ungünstigste Fall ist die niedrigste tatsächliche Innentemperatur.
  if (monateOk && istZahl(v.innentemperaturIst?.min)) {
    const g = gradtage(monate, v.innentemperaturIst.min);
    if (!(g.g > 0)) {
      meldungen.push(fehler('innentemperaturIst', 'Bei dieser Innentemperatur wird die umgerechnete Gradtagzahl nicht positiv. Bitte Innentemperatur und Gradtage prüfen.'));
    }
  }
  return meldungen;
}

// Für die Szenarien: dieselben Zahlenprüfungen mit eigenen Feldnamen.
export { zahl as pruefeZahl, bereich as pruefeBereich, fehler as fehlerMeldung, warnung as warnMeldung };

// Wärmepumpe im Katalog. Fehler: unlesbare oder widersprüchliche Angaben. Warnungen: unplausible Werte und fehlende Pflichtwerte
// für die Prüfung (die Wärmepumpe lässt sich trotzdem ablegen, die App nennt dann, was fehlt).
export function validiereWaermepumpe(g) {
  const meldungen = [...pflichtText('modell', g.modell, 'Modell')];
  const optionalZahl = (feld, wert, opt) => (wert === null || wert === undefined ? [] : zahl(feld, wert, opt));
  if (g.preis) {
    meldungen.push(...bereich('preis', g.preis, { name: 'Preis', einheit: '€', fehlerWennKleiner: 0 }));
  }
  if (typeof g.datenblatt === 'string' && g.datenblatt.trim() !== '' && !/^https?:\/\//i.test(g.datenblatt.trim())) {
    meldungen.push(warnung('datenblatt', 'Der Link beginnt nicht mit http:// oder https://, er wird deshalb nur als Text angezeigt.'));
  }
  const b = g.bafa ?? {};
  meldungen.push(
    ...optionalZahl('bafa.nennleistung55', b.nennleistung55, { name: 'BAFA-Nennleistung', einheit: 'kW', fehlerWennKleinerGleich: 0, warnWennUeber: 30 }),
    ...optionalZahl('bafa.eta35', b.eta35, { name: 'ETAs 35 °C', einheit: '%', fehlerWennKleinerGleich: 0, warnWennUeber: 300, warnWennUnter: 100 }),
    ...optionalZahl('bafa.eta55', b.eta55, { name: 'ETAs 55 °C', einheit: '%', fehlerWennKleinerGleich: 0, warnWennUeber: 300, warnWennUnter: 100 }),
    ...optionalZahl('schall', g.schall, { name: 'Schallleistungspegel', einheit: 'dB(A)', fehlerWennKleinerGleich: 0, warnWennUeber: 90, warnWennUnter: 30 }),
  );
  (g.punkte ?? []).forEach((p, i) => {
    const wo = `Leistungspunkt ${i + 1}`;
    meldungen.push(
      ...zahl('punkte', p.aussen, { name: `${wo}: Außentemperatur`, einheit: '°C', warnWennUeber: 40, warnWennUnter: -30 }),
      ...zahl('punkte', p.vorlauf, { name: `${wo}: Vorlauftemperatur`, einheit: '°C', fehlerWennKleinerGleich: 0, warnWennUeber: 75 }),
      ...optionalZahl('punkte', p.max, { name: `${wo}: maximale Heizleistung`, einheit: 'kW', fehlerWennKleinerGleich: 0, warnWennUeber: 40 }),
      ...optionalZahl('punkte', p.min, { name: `${wo}: minimale Heizleistung`, einheit: 'kW', fehlerWennKleinerGleich: 0, warnWennUeber: 40 }),
      ...optionalZahl('punkte', p.cop, { name: `${wo}: COP`, fehlerWennKleinerGleich: 0, warnWennUeber: 10 }),
    );
    if ((p.max === null || p.max === undefined) && (p.min === null || p.min === undefined)) {
      meldungen.push(fehler('punkte', `${wo}: Bitte die maximale oder die minimale Heizleistung eintragen.`));
    }
    if (istZahl(p.max) && istZahl(p.min) && p.min > p.max) meldungen.push(fehler('punkte', `${wo}: Die minimale Heizleistung darf nicht größer als die maximale sein.`));
  });
  const fehlend = fehlendeWerte(g);
  if (fehlend.length > 0 && (g.punkte ?? []).length > 0 && !hatFehler(meldungen)) {
    meldungen.push(warnung('punkte', `Für die Prüfung fehlen: ${fehlend.join(', ')}. Ohne diese Werte zeigt die App „nicht prüfbar“.`));
  }
  return meldungen;
}
