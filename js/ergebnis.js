// Ergebnis auf einen Blick: Gesamtheizlast, Verluste nach Art, benötigte Wärmepumpenleistung, Heizlast bei verschiedenen
// Außentemperaturen, Plausibilität und Datenqualität. Reine Funktionen ohne Oberfläche.
// Der Bildschirm (views/ergebnis.js) und der Bericht (bericht.js) nutzen dieselben Zahlen und Texte.
//
// Die Geräteprüfung (Wärmepumpen aus dem Katalog gegen die Heizlastlinie) steht in geraete.js.

import { formatZahl } from './engine/format.js';
import { VORLAUF_MAX } from './engine/vorlauf.js';
import { berechneAnsicht, VERLUST_ARTEN } from './vergleich.js';
import { pruefeVollstaendigkeit } from './plan.js';
import { flaecheAusMassen, mittlereInnentemperatur } from './modell.js';
import { leistungFehlt, auswerten, abweichungsText, wattBereichVon, watt } from './anzeige.js';

export const AUSSENTEMPERATUREN = [-8, -5, -2, 2, 7, 12];

export const TYPEN_HINWEIS = 'Die Typenbezeichnung einer Wärmepumpe ist kein Maß. Vergleiche mit der Heizleistung im Datenblatt bei −7 °C bzw. −10 °C und der genannten Vorlauftemperatur.';
export const MILD_HINWEIS = 'Bei milden Temperaturen muss die Wärmepumpe so weit herunterregeln können, sonst taktet sie.';
export const UNVOLLSTAENDIG_TEXT = 'Ergebnis unvollständig, Heizlast vermutlich zu niedrig.';

const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const mitMinus = (x, stellen) => `${x < 0 ? '−' : ''}${formatZahl(Math.abs(x), stellen)}`;
const kW = (w, stellen = 2) => `${mitMinus(w / 1000, stellen)} kW`;
const gradText = (t) => mitMinus(t, Number.isInteger(t) ? 0 : 1);

// --- Annahmen zur Wärmepumpe (einstellungen.waermepumpe) --------------------------------------------------------

// Sperrstunden des Netzbetreibers je Tag: 0 bis unter 24. Fehlt die Angabe, gilt 0 (kein Zuschlag).
export function waermepumpenannahmen(einstellungen) {
  const roh = einstellungen?.waermepumpe?.sperrstunden;
  if (roh === undefined || roh === null) return { sperrstunden: 0, ungueltig: false };
  if (istZahl(roh) && roh >= 0 && roh < 24) return { sperrstunden: roh, ungueltig: false };
  return { sperrstunden: 0, ungueltig: true };
}

// Zuschlag für die Sperrzeit: Die Wärmepumpe liefert die Tageswärme in (24 − s) Stunden,
//   Φ_Sperre = Φ · 24 / (24 − s) − Φ
export function sperrzeitZuschlag(heizlastW, sperrstunden) {
  if (!(sperrstunden > 0) || !(sperrstunden < 24)) return 0;
  return (heizlastW * 24) / (24 - sperrstunden) - heizlastW;
}

// Alle Zuschläge mit Begründung. Ohne Eingabe gibt es keinen: kein pauschaler Sicherheitszuschlag.
export function zuschlaege(heizlastW, wp) {
  const liste = [];
  if (wp.sperrstunden > 0) {
    const wert = sperrzeitZuschlag(heizlastW, wp.sperrstunden);
    liste.push({
      id: 'sperrzeit',
      name: 'Sperrzeit des Netzbetreibers',
      wert,
      begruendung: `${String(wp.sperrstunden).replace('.', ',')} h Sperre je Tag: Die Wärme eines Tages muss in ${String(24 - wp.sperrstunden).replace('.', ',')} h geliefert werden. `
        + `Zuschlag = Heizlast · 24 / (24 − ${String(wp.sperrstunden).replace('.', ',')}) − Heizlast.`,
    });
  }
  return liste;
}

// --- Heizlast bei verschiedenen Außentemperaturen ---------------------------------------------------------------

// Linear: H = Φ / (θ_soll,Mittel − θ_e) in W/K, Φ(θ) = H · (θ_soll,Mittel − θ), nie negativ. Je Punkt untere und obere Grenze.
// bandbreite { min, max } in W bei der Normaußentemperatur thetaAussen.
export function heizlastLinie(bandbreite, thetaMittel, thetaAussen, temperaturen = AUSSENTEMPERATUREN) {
  if (!bandbreite) return { ok: false, grund: 'Heizlast nicht berechenbar' };
  if (!istZahl(thetaMittel)) return { ok: false, grund: 'keine mittlere Soll-Temperatur aus den Räumen' };
  const dt = thetaMittel - thetaAussen;
  if (!(dt > 0)) return { ok: false, grund: 'Die mittlere Soll-Temperatur liegt nicht über der Normaußentemperatur' };
  const hMin = bandbreite.min / dt;
  const hMax = bandbreite.max / dt;
  return {
    ok: true,
    thetaMittel,
    thetaAussen,
    hMin,
    hMax,
    punkte: temperaturen.map((theta) => {
      const d = Math.max(thetaMittel - theta, 0);
      return { theta, min: hMin * d, max: hMax * d };
    }),
  };
}

// --- Datenqualität ----------------------------------------------------------------------------------------------

// Zählt die Lücken, die das Ergebnis betreffen. Rot: Die Heizlast ist vermutlich zu niedrig (Flächen ohne Maß,
// fehlende Hüllfläche, Dach oder Boden, passive Räume ohne vollständige Verteilung). Gelb: Angaben fehlen, die nur
// die Aussage zum Vorlauf oder Details betreffen. Grün: nichts gefunden.
export function datenqualitaet(projekt) {
  const raumName = (id) => projekt.raeume.find((r) => r.id === id)?.name ?? 'Raum';
  const mitHeizung = projekt.raeume.filter((r) => r.status !== 'unbeheizt');
  const ids = new Set(mitHeizung.map((r) => r.id));

  const ohneMass = projekt.flaechen.filter((f) => ids.has(f.raumId) && !Number.isFinite(flaecheAusMassen(f)));
  const ohneLeistung = projekt.heizkoerper.filter((h) => h.status !== 'entfaellt' && leistungFehlt(h)
    && projekt.raeume.find((r) => r.id === h.raumId)?.status === 'beheizt');
  const passiv = projekt.raeume.filter((r) => r.status === 'passiv').filter((r) => {
    const summe = (r.waermeLieferanten ?? []).reduce((s, l) => s + (l.prozent ?? 0), 0);
    return Math.abs(summe - 100) > 0.01;
  });
  const pruefung = pruefeVollstaendigkeit(projekt).filter((p) => p.geprueft && p.gesamt !== 'ok');
  const roteRaeume = pruefung.filter((p) => p.punkte.some((q) => q.stufe === 'fehler' && q.id !== 'heizkoerper'));

  const nachRaum = (liste, f) => {
    const karte = new Map();
    for (const x of liste) karte.set(raumName(x.raumId), (karte.get(raumName(x.raumId)) ?? 0) + 1);
    return [...karte].map(([name, n]) => f(name, n));
  };
  const details = [
    ...nachRaum(ohneMass, (name, n) => ({ art: 'masse', rot: true, text: `${name}: ${n} Fläche${n === 1 ? '' : 'n'} ohne vollständiges Maß` })),
    ...nachRaum(ohneLeistung, (name, n) => ({ art: 'leistung', rot: false, text: `${name}: Leistung fehlt bei ${n} Heizkörper${n === 1 ? '' : 'n'}` })),
    ...pruefung.map((p) => ({
      art: 'luecke',
      rot: roteRaeume.includes(p),
      text: `${p.name}: ${p.punkte.filter((q) => q.stufe !== 'ok').map((q) => `${q.titel} (${q.text})`).join('; ')}`,
    })),
    ...passiv.map((r) => {
      const summe = (r.waermeLieferanten ?? []).reduce((s, l) => s + (l.prozent ?? 0), 0);
      return { art: 'verteilung', rot: true, text: `${r.name}: Verteilung ${formatZahl(summe, 1)} % statt 100 %` };
    }),
  ];
  const zaehler = {
    flaechenOhneMass: ohneMass.length,
    heizkoerperOhneLeistung: ohneLeistung.length,
    raeumeMitLuecken: pruefung.length,
    passiveVerteilung: passiv.length,
  };
  const rot = ohneMass.length > 0 || passiv.length > 0 || roteRaeume.length > 0;
  const gelb = !rot && (ohneLeistung.length > 0 || pruefung.length > 0);
  const ampel = rot ? 'rot' : gelb ? 'gelb' : 'gruen';
  const meldung = rot ? UNVOLLSTAENDIG_TEXT
    : gelb ? 'Einzelne Angaben sind lückenhaft. Die Heizlast ist nutzbar, die Aussagen dazu sind eingeschränkt.'
      : 'Keine Lücken gefunden.';
  return { ampel, meldung, zaehler, details };
}

// --- Gesamtergebnis ---------------------------------------------------------------------------------------------

function vorlaufDesHauses(a) {
  const zeilen = a.bewertung?.zeilen ?? [];
  const fehlend = zeilen.filter((z) => z.vorlauf.status === 'leistung_fehlt').map((z) => z.name);
  const ohneHk = zeilen.filter((z) => z.vorlauf.status === 'kein_heizkoerper').map((z) => z.name);
  const best = a.bestimmend;
  const liste = (namen) => namen.join(', ');
  if (best?.vorlauf.status === 'ok') {
    const luecken = [
      ...(fehlend.length > 0 ? [`Heizkörperleistung fehlt in ${liste(fehlend)}, dort kann der Vorlauf höher liegen.`] : []),
      ...(ohneHk.length > 0 ? [`Kein Heizkörper in ${liste(ohneHk)}, dort ist der Vorlauf nicht bestimmbar.`] : []),
    ];
    return { art: 'ok', grad: best.vorlauf.vorlauf, raum: best.name, untergrenze: Boolean(best.vorlauf.untergrenzeDatenblatt), luecken };
  }
  if (best?.vorlauf.status === 'nicht_deckbar') {
    return { art: 'nicht_deckbar', raum: best.name, text: `über ${VORLAUF_MAX} °C: „${best.name}“ ist auch bei ${VORLAUF_MAX} °C nicht gedeckt`, luecken: [] };
  }
  const grund = fehlend.length > 0 ? `Heizkörperleistung fehlt in ${liste(fehlend)}`
    : ohneHk.length > 0 ? `Kein Heizkörper in ${liste(ohneHk)}`
      : zeilen.length === 0 ? 'keine beheizten Räume' : 'keine auswertbaren Heizkörper';
  return { art: 'nicht_bestimmbar', text: `Vorlauf nicht bestimmbar: ${grund}`, luecken: [] };
}

// Verlustzeilen: nur Arten mit Verlust, Anteil an der Summe. Die Summe entspricht der Gebäudeheizlast (Mittelwert).
function verlustZeilen(verluste) {
  const summe = VERLUST_ARTEN.reduce((s, a) => s + verluste[a.id], 0);
  return {
    summe,
    zeilen: VERLUST_ARTEN.filter((a) => Math.abs(verluste[a.id]) > 0.5).map((a) => ({
      id: a.id, name: a.name, w: verluste[a.id], prozent: summe > 0 ? (verluste[a.id] / summe) * 100 : 0,
    })),
  };
}

// projekt: Projekt (Ist-Zustand oder Szenario, mit angewendeten Abweichungen). optionen.mitVerbrauch: Verbrauchsabgleich auswerten.
export function baueErgebnis(projekt, { mitVerbrauch = true } = {}) {
  const a = berechneAnsicht(projekt);
  const wp = waermepumpenannahmen(projekt.einstellungen);
  const thetaAussen = projekt.einstellungen.thetaAussen;
  const qualitaet = datenqualitaet(projekt);
  const basis = { name: projekt.szenario?.name ?? 'Ist-Zustand', fehler: a.fehler, qualitaet, wp: { ...wp }, thetaAussen };
  if (!a.bandbreite) return { ...basis, hatErgebnis: false };

  const obere = a.bandbreite.max;
  const liste = zuschlaege(obere, wp);
  const gesamt = obere + liste.reduce((s, x) => s + x.wert, 0);
  const thetaMittel = mittlereInnentemperatur(projekt.raeume);
  const verbrauch = !mitVerbrauch ? null : projekt.verbrauch.map((doc) => {
    const aus = auswerten(doc, projekt, a.bandbreite);
    return {
      name: doc.name,
      ok: aus.ergebnis?.status === 'ok',
      band: aus.ergebnis?.status === 'ok' ? aus.ergebnis.heizlast : null,
      abweichung: aus.vergleich ? abweichungsText(aus.vergleich).replace(' (Mittelwert Verbrauch gegenüber Berechnung)', '') : null,
      prozent: aus.vergleich?.abweichungProzent ?? null,
    };
  });

  return {
    ...basis,
    hatErgebnis: true,
    bandbreite: a.bandbreite,
    mittel: a.mittel,
    obere,
    verluste: verlustZeilen(a.verluste),
    waermepumpe: { obereW: obere, zuschlaege: liste, gesamtW: gesamt, vorlauf: vorlaufDesHauses(a) },
    thetaMittel,
    linie: heizlastLinie(a.bandbreite, thetaMittel, thetaAussen),
    verbrauch,
  };
}

// --- Texte ------------------------------------------------------------------------------------------------------

// „Benötigt: X kW Heizleistung bei −8 °C Außentemperatur und Y °C Vorlauf“ (oder der Grund, warum Y fehlt).
export function benoetigtText(erg) {
  const w = erg.waermepumpe;
  const kopf = `Benötigt: ${kW(w.gesamtW)} Heizleistung bei ${gradText(erg.thetaAussen)} °C Außentemperatur`;
  const v = w.vorlauf;
  if (v.art === 'ok') return `${kopf} und ${v.untergrenze ? '≤ ' : ''}${formatZahl(v.grad, 1)} °C Vorlauf`;
  return `${kopf}. ${v.text}`;
}

export const ampelText = { gruen: 'Daten vollständig', gelb: 'Daten lückenhaft', rot: 'Daten unvollständig' };

export function zaehlerText(z) {
  return [
    ['Flächen ohne Maß', z.flaechenOhneMass],
    ['Heizkörper ohne Leistung', z.heizkoerperOhneLeistung],
    ['Räume mit Lücken in der Vollständigkeitsprüfung', z.raeumeMitLuecken],
    ['Passive Räume mit Verteilung ≠ 100 %', z.passiveVerteilung],
  ];
}

// Heizlastlinie als Tabelle: Außentemperatur, untere und obere Grenze in kW.
export function liniePunktText(p) {
  return { theta: `${mitMinus(p.theta, 0)} °C`, min: kW(p.min, 1), max: kW(p.max, 1) };
}

// --- Berichtsblöcke ---------------------------------------------------------------------------------------------

const BALKEN_ZEICHEN = '█';
export const balken = (prozent, breite = 20) => BALKEN_ZEICHEN.repeat(Math.max(0, Math.round((prozent / 100) * breite)));

// Blöcke für den Bericht (siehe bericht.js): text, box, zwischentitel, liste, paare, tabelle.
export function ergebnisBloecke(erg) {
  const text = (t) => ({ art: 'text', text: t });
  const box = (t, stufe = 'hinweis') => ({ art: 'box', text: t, stufe });
  const zwischentitel = (t) => ({ art: 'zwischentitel', text: t });
  const liste = (e) => ({ art: 'liste', eintraege: e });
  const paare = (z) => ({ art: 'paare', zeilen: z });
  const tabelle = (kopf, zeilen, ausrichtung, hervor = []) => ({ art: 'tabelle', kopf, zeilen, ausrichtung, summenzeile: false, hervor });

  const bloecke = [];
  const q = erg.qualitaet;
  if (q.ampel !== 'gruen') {
    bloecke.push(box(`Datenqualität: ${q.meldung}`, q.ampel === 'rot' ? 'fehler' : 'hinweis'));
    bloecke.push(liste(q.details.map((d) => d.text)));
  }
  if (erg.fehler) bloecke.push(box(`Rechenfehler: ${erg.fehler}`, 'fehler'));
  if (!erg.hatErgebnis) {
    bloecke.push(text('Es gibt noch keine berechenbaren Räume.'));
    return bloecke;
  }

  bloecke.push(zwischentitel('Gesamtheizlast'));
  bloecke.push(tabelle(['Kennzahl', 'Wert'], [
    [`Bandbreite bei ${gradText(erg.thetaAussen)} °C (günstig bis ungünstig)`, wattBereichVon(erg.bandbreite)],
    ['Mittelwert', watt(erg.mittel)],
    ['Obere Grenze (Auslegungswert)', watt(erg.obere)],
  ], 'lr', [2]));

  bloecke.push(zwischentitel('Aufteilung nach Verlustart'));
  bloecke.push(tabelle(
    ['Verlustart', 'Verlust', 'Anteil', ''],
    [...erg.verluste.zeilen.map((v) => [v.name, watt(v.w), `${formatZahl(v.prozent, 1)} %`, balken(v.prozent)]),
      ['Summe = Gebäudeheizlast (Mittelwert)', watt(erg.verluste.summe), '100 %', '']],
    'lrrl',
  ));

  bloecke.push(zwischentitel('Benötigte Wärmepumpenleistung'));
  const w = erg.waermepumpe;
  bloecke.push(box(benoetigtText(erg), 'hinweis'));
  bloecke.push(tabelle(['Bestandteil', 'Leistung', 'Begründung'], [
    ['Obere Grenze der Gebäudeheizlast', kW(w.obereW, 3), 'Ungünstige Rechnung (alle Unsicherheiten ungünstig).'],
    ...w.zuschlaege.map((x) => [`Zuschlag: ${x.name}`, kW(x.wert, 3), x.begruendung]),
    ['Summe', kW(w.gesamtW, 3), w.zuschlaege.length === 0 ? 'Keine Zuschläge angesetzt (kein pauschaler Sicherheitszuschlag, keine Rundung auf Gerätegrößen).' : 'Heizlast plus Zuschläge, nicht auf Gerätegrößen gerundet.'],
  ], 'lrl', [w.zuschlaege.length + 1]));
  if (w.vorlauf.art === 'ok') {
    bloecke.push(text(`Nötige Vorlauftemperatur: ${w.vorlauf.untergrenze ? '≤ ' : ''}${formatZahl(w.vorlauf.grad, 1)} °C, bestimmender Raum „${w.vorlauf.raum}“ (ungünstige Heizlast).`));
    if (w.vorlauf.luecken.length > 0) bloecke.push(box(w.vorlauf.luecken.join(' '), 'fehler'));
  } else {
    bloecke.push(box(w.vorlauf.text, 'fehler'));
  }
  bloecke.push(box(TYPEN_HINWEIS));

  bloecke.push(zwischentitel('Heizlast bei verschiedenen Außentemperaturen'));
  if (erg.linie.ok) {
    bloecke.push(tabelle(['Außentemperatur', 'Untere Grenze', 'Obere Grenze'], erg.linie.punkte.map((p) => {
      const t = liniePunktText(p);
      return [t.theta, t.min, t.max];
    }), 'lrr'));
    bloecke.push(text(`Linear nach H = Heizlast / (θ_soll,Mittel − θ_e) mit θ_soll,Mittel = ${formatZahl(erg.linie.thetaMittel, 1)} °C: `
      + `H = ${formatZahl(erg.linie.hMin, 1)} bis ${formatZahl(erg.linie.hMax, 1)} W/K.`));
    bloecke.push(box(MILD_HINWEIS));
  } else {
    bloecke.push(text(`Nicht berechenbar: ${erg.linie.grund}.`));
  }

  if (erg.verbrauch) {
    bloecke.push(zwischentitel('Plausibilität: Verbrauchsabgleich'));
    bloecke.push(erg.verbrauch.length === 0
      ? text('Kein Verbrauchsabgleich vorhanden.')
      : paare(erg.verbrauch.map((v) => [v.name, v.ok ? `${wattBereichVon(v.band)} aus dem Verbrauch${v.abweichung ? `, ${v.abweichung}` : ''}` : 'unvollständig, nicht ausgewertet'])));
  }

  bloecke.push(zwischentitel('Datenqualität'));
  bloecke.push(paare(zaehlerText(q.zaehler).map(([n, x]) => [n, String(x)])));
  return bloecke;
}
