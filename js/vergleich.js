// Szenarienvergleich: rechnet den Ist-Zustand und jedes Szenario durch und baut die Vergleichstabellen.
// Reine Funktionen ohne Oberfläche. Bildschirm und Bericht nutzen dieselben Tabellen.

import { formatZahl } from './engine/format.js';
import { rechne, bewerteVorlauf } from './daten.js';
import { wendeSzenarioAn, kostenNachFoerderung, kostenEingetragen } from './szenario.js';
import { mittlereInnentemperatur } from './modell.js';
import { vergleichsannahmen, loeseGradtageAuf, berechneJahreswaerme, JAHRESHINWEIS } from './jahreswaerme.js';
import { berechneteBandbreite, wattBereich, watt, vorlaufText } from './anzeige.js';

const summe = (werte) => werte.reduce((a, b) => a + b, 0);
const TOLERANZ_W = 1e-6;

// Verlustarten für „woher kommt die Minderung“. Fenster und Türen sind die Öffnungen in den Flächen,
// die Flächenverluste (ohne Öffnungen) gehen nach Gegenseite und Bauteilart in Erdreich, Nachbar, Dach,
// Kellerdecke, Außenwand oder Sonstige.
export const VERLUST_ARTEN = [
  { id: 'dach', name: 'Dach' },
  { id: 'aussenwand', name: 'Außenwand' },
  { id: 'fenster', name: 'Fenster und Türen' },
  { id: 'kellerdecke', name: 'Kellerdecke' },
  { id: 'erdreich', name: 'Erdreich' },
  { id: 'nachbar', name: 'Nachbar' },
  { id: 'sonstige', name: 'Sonstige Flächen' },
  { id: 'lueftung', name: 'Lüftung' },
  { id: 'aufheizung', name: 'Aufheizzuschlag' },
];

function artDerFlaeche(projekt, flaeche) {
  const ang = flaeche.angrenzend;
  if (ang?.art === 'zone') {
    const zone = projekt.zonen.find((zz) => zz.id === ang.zoneId);
    if (zone?.art === 'erdreich') return 'erdreich';
    if (zone?.art === 'nachbar') return 'nachbar';
  }
  const bauteil = projekt.bauteile.find((b) => b.id === flaeche.bauteilId);
  if (bauteil?.art === 'dach') return 'dach';
  if (bauteil?.art === 'kellerdecke') return 'kellerdecke';
  if (bauteil?.art === 'aussenwand') return 'aussenwand';
  return 'sonstige';
}

// Verluste des Gebäudes in W nach Art, Mittel aus günstiger und ungünstiger Rechnung. Raum-zu-Raum-Ströme gehören
// nicht dazu: sie bleiben im Haus. Die Summe entspricht deshalb der Gebäudeheizlast (Gebäudesumme).
export function verlusteNachArt(projekt, ergebnis) {
  const ergebnisart = Object.fromEntries(VERLUST_ARTEN.map((a) => [a.id, 0]));
  if (!ergebnis) return ergebnisart;
  for (const fall of ['guenstig', 'ungunstig']) {
    for (const raum of ergebnis.raeume) {
      const r = raum[fall];
      for (const f of r.flaechen) {
        const flaeche = projekt.flaechen.find((x) => x.id === f.id);
        if (!flaeche) continue;
        ergebnisart[artDerFlaeche(projekt, flaeche)] += f.wand / 2;
        ergebnisart.fenster += f.oeffnungen / 2;
      }
      ergebnisart.lueftung += r.lueftung / 2;
      ergebnisart.aufheizung += r.aufheizung / 2;
    }
  }
  return ergebnisart;
}

// Eine Ansicht (Ist-Zustand oder Szenario) durchrechnen. projekt: Projekt mit angewendeten Abweichungen.
export function berechneAnsicht(projekt) {
  const { ergebnis, hinweise, fehler } = rechne(projekt);
  const hatRaeume = Boolean(ergebnis) && ergebnis.raeume.length > 0;
  const ziel = projekt.einstellungen.zielVorlauf ?? 45;
  const bewertung = hatRaeume ? bewerteVorlauf(projekt, ergebnis, ziel) : null;
  const bestimmend = bewertung?.zeilen.find((r) => r.bestimmend) ?? null;
  const unterdeckung = bewertung ? bewertung.zeilen.filter((r) => r.differenz !== null && r.differenz < -TOLERANZ_W) : [];
  const ohneBewertung = bewertung ? bewertung.zeilen.filter((r) => r.installiert === null || r.vorlauf.status === 'leistung_fehlt') : [];
  return {
    projekt, ergebnis, hinweise, fehler, bewertung, ziel,
    bandbreite: hatRaeume ? berechneteBandbreite(ergebnis) : null,
    mittel: hatRaeume ? ergebnis.gebaeude.mittel.summe : null,
    bestimmend,
    raeumeMitUnterdeckung: unterdeckung.length,
    raeumeBewertet: bewertung ? bewertung.zeilen.length : 0,
    raeumeOhneBewertung: ohneBewertung.length,
    verluste: verlusteNachArt(projekt, ergebnis),
  };
}

// Vergleich: Ist-Zustand plus alle Szenarien. ist: Projekt wie aus ladeProjekt() (ohne Szenario), szenarien: Liste.
export function baueVergleich(ist, szenarien, annahmen = vergleichsannahmen(ist.einstellungen)) {
  const basis = { id: null, name: 'Ist-Zustand', szenario: null, szenarioHinweise: [], ...berechneAnsicht(ist) };
  const spalten = [basis];
  for (const s of szenarien) {
    const { projekt, hinweise } = wendeSzenarioAn(ist, s);
    const a = berechneAnsicht(projekt);
    spalten.push({ id: s.id, name: s.name, szenario: s, szenarioHinweise: hinweise, ...a });
  }
  // Jahreswärme-Differenz: Ist-Zustand minus Szenario, als Bandbreite aus der günstigen und der ungünstigen Rechnung.
  const thetaMittel = mittlereInnentemperatur(ist.raeume);
  const g = loeseGradtageAuf(ist.verbrauch ?? [], annahmen, thetaMittel);
  for (const sp of spalten) {
    sp.kostenNachFoerderung = sp.szenario ? kostenNachFoerderung(sp.szenario.kosten) : null;
    if (!sp.szenario) { sp.jahr = null; continue; }
    const ig = basis.ergebnis?.gebaeude;
    const sg = sp.ergebnis?.gebaeude;
    const deltas = ig && sg ? [ig.guenstig.summe - sg.guenstig.summe, ig.ungunstig.summe - sg.ungunstig.summe] : null;
    const deltaPhi = deltas ? { min: Math.min(...deltas), max: Math.max(...deltas) } : null;
    sp.jahr = {
      ...berechneJahreswaerme({
        deltaPhi, thetaMittel, thetaAussen: ist.einstellungen.thetaAussen, gradtage: g.g, jaz: annahmen.jaz, strompreis: annahmen.strompreis,
      }),
      deltaPhi,
    };
  }
  for (const sp of spalten) {
    sp.minderungW = basis.mittel !== null && sp.mittel !== null ? basis.mittel - sp.mittel : null;
    sp.minderungProzent = sp.minderungW !== null && basis.mittel > 0 ? (sp.minderungW / basis.mittel) * 100 : null;
  }
  return { spalten, annahmen, thetaMittel, gradtage: g };
}

// --- Texte -----------------------------------------------------------------------------------

const mitMinus = (x, stellen) => `${x < 0 ? '−' : ''}${formatZahl(Math.abs(x), stellen)}`;

// Minderung gegenüber dem Ist-Zustand (Mittelwert): positiv heißt weniger Heizlast, negativ heißt Mehrbedarf.
export function minderungText(sp) {
  if (sp.id === null) return '–';
  if (sp.minderungW === null) return 'nicht berechenbar';
  return `${mitMinus(sp.minderungW / 1000, 2)} kW (${sp.minderungProzent === null ? '–' : `${mitMinus(sp.minderungProzent, 1)} %`})`;
}

const rund = (x, stellen) => Math.round(x * 10 ** stellen) / 10 ** stellen;
// Bandbreite als Text: „von – bis“, bei gleichen Werten nur einer. Minus als „−“.
export function bandText(b, stellen, einheit) {
  if (!b) return '–';
  const t = (x) => mitMinus(rund(x, stellen), stellen);
  const a = t(b.min);
  const c = t(b.max);
  return `${a === c ? a : `${a} – ${c}`}${einheit ? ` ${einheit}` : ''}`;
}

// Eingegebene Werte ohne feste Nachkommastellen (30 statt 30,0).
const bandKurz = (b, einheit) => {
  const t = (x) => String(rund(x, 2)).replace('.', ',');
  return `${t(b.min) === t(b.max) ? t(b.min) : `${t(b.min)} – ${t(b.max)}`}${einheit ? ` ${einheit}` : ''}`;
};

function vorlaufHausText(sp) {
  if (!sp.bestimmend) return sp.bewertung ? 'nicht bestimmbar' : '–';
  return `${vorlaufText(sp.bestimmend.vorlauf)} (${sp.bestimmend.name})`;
}

export const AUSLEGUNGSWERT = 'Auslegungswert Wärmepumpe (obere Grenze)';

function annahmenTexte(vergleich, mitJaz, mitPreis) {
  const a = vergleich.annahmen;
  if (!a) return [];
  const komma = (x) => String(x).replace('.', ',');
  const texte = [
    vergleich.thetaMittel === null || vergleich.thetaMittel === undefined
      ? 'Mittlere Soll-Temperatur: nicht berechenbar (keine Räume mit Fläche und Temperatur)'
      : `Mittlere Soll-Temperatur θ_soll,Mittel = ${komma(rund(vergleich.thetaMittel, 1))} °C (nach Raumfläche gewichtet), Normaußentemperatur θ_e = ${komma(vergleich.spalten[0].projekt.einstellungen.thetaAussen)} °C`,
    `Gradtagzahl G: ${vergleich.gradtage.text}`,
  ];
  texte.push(mitJaz ? `Jahresarbeitszahl JAZ: ${bandKurz(a.jaz)}` : 'Jahresarbeitszahl: nicht angegeben, daher keine Stromrechnung');
  if (mitJaz) texte.push(mitPreis ? `Strompreis: ${bandKurz(a.strompreis, 'ct/kWh')}` : 'Strompreis: nicht angegeben, daher keine Kostenrechnung');
  return texte;
}

// Tabellen für Bildschirm und Bericht: { kopf, zeilen } mit Zeichenketten.
export function vergleichTabellen(vergleich) {
  const sp = vergleich.spalten;
  const kopfmitName = ['', ...sp.map((s) => s.name)];
  const kosten = (f) => sp.map((s) => (s.szenario ? f(s.szenario) : '–'));
  const kennzahlen = {
    kopf: ['Kennzahl', ...sp.map((s) => s.name)],
    zeilen: [
      ['Gebäudeheizlast (günstig bis ungünstig)', ...sp.map((s) => (s.bandbreite ? wattBereich(s.bandbreite.min, s.bandbreite.max) : s.fehler ? 'Rechenfehler' : '–'))],
      [AUSLEGUNGSWERT, ...sp.map((s) => (s.bandbreite ? watt(s.bandbreite.max) : '–'))],
      ['Gebäudeheizlast, Mittelwert', ...sp.map((s) => (s.mittel !== null ? watt(s.mittel) : '–'))],
      ['Minderung gegenüber Ist-Zustand (Mittelwert, negativ = Mehrbedarf)', ...sp.map(minderungText)],
      ['Investitionskosten (von – bis)', ...kosten((z) => (kostenEingetragen(z.kosten.investition) ? bandText(z.kosten.investition, 0, '€') : '–'))],
      ['Förderung (von – bis)', ...kosten((z) => (kostenEingetragen(z.kosten.foerderung) ? bandText(z.kosten.foerderung, 0, '€') : '–'))],
      ['Kosten nach Förderung (von – bis)', ...sp.map((s) => (s.szenario ? (s.kostenNachFoerderung ? bandText(s.kostenNachFoerderung, 0, '€') : '–') : '–'))],
      ['Quelle der Kosten', ...kosten((z) => z.kosten.quelle || '–')],
      ['Nötige Vorlauftemperatur des Hauses (bestimmender Raum)', ...sp.map(vorlaufHausText)],
      ['Ziel-Vorlauftemperatur', ...sp.map((s) => `${formatZahl(s.ziel, 0)} °C`)],
      ['Räume mit Unterdeckung bei der Ziel-Vorlauftemperatur', ...sp.map((s) => (s.bewertung ? `${s.raeumeMitUnterdeckung} von ${s.raeumeBewertet}${s.raeumeOhneBewertung > 0 ? ` (${s.raeumeOhneBewertung} ohne Bewertung)` : ''}` : '–'))],
      ['Hinweise zu den Abweichungen', ...sp.map((s) => (s.id === null ? '–' : s.szenarioHinweise.length === 0 ? 'keine' : `${s.szenarioHinweise.length}`))],
    ],
    ausrichtung: `l${'l'.repeat(sp.length)}`,
    hervor: [1],
  };

  // Jahreswärme-Differenz je Szenario (ohne die Ist-Spalte): Minderung gegenüber dem Ist-Zustand, positiv = weniger Bedarf.
  const szenarioSpalten = sp.slice(1);
  const mitJaz = Number.isFinite(vergleich.annahmen?.jaz.min) && Number.isFinite(vergleich.annahmen?.jaz.max);
  const mitPreis = mitJaz && Number.isFinite(vergleich.annahmen.strompreis.min) && Number.isFinite(vergleich.annahmen.strompreis.max);
  const jahrZelle = (s, feld, stellen, einheit) => {
    if (!s.jahr) return '–';
    if (s.jahr[feld]) return bandText(s.jahr[feld], stellen, einheit);
    return s.jahr.grund ?? '–';
  };
  const jahreswaerme = {
    kopf: ['Kennzahl (Minderung gegenüber dem Ist-Zustand, negativ = Mehrbedarf)', ...szenarioSpalten.map((s) => s.name)],
    zeilen: [
      ['Minderung der Gebäudeheizlast ΔΦ (günstig bis ungünstig)', ...szenarioSpalten.map((s) => (s.jahr?.deltaPhi ? bandText(s.jahr.deltaPhi, 0, 'W') : '–'))],
      ['Minderung des Wärmeverlusts ΔH', ...szenarioSpalten.map((s) => jahrZelle(s, 'deltaH', 2, 'W/K'))],
      ['Wärmeminderung ΔQ pro Jahr', ...szenarioSpalten.map((s) => jahrZelle(s, 'deltaQ', 0, 'kWh/a'))],
      ...(mitJaz ? [['Stromminderung ΔStrom pro Jahr (mit JAZ)', ...szenarioSpalten.map((s) => jahrZelle(s, 'deltaStrom', 0, 'kWh/a'))]] : []),
      ...(mitPreis ? [['Stromkosten-Minderung pro Jahr', ...szenarioSpalten.map((s) => jahrZelle(s, 'kosten', 1, '€/a'))]] : []),
    ],
    ausrichtung: `l${'l'.repeat(szenarioSpalten.length)}`,
    hinweis: JAHRESHINWEIS,
    annahmen: annahmenTexte(vergleich, mitJaz, mitPreis),
  };

  const ist = sp[0];
  const raumListe = ist.ergebnis ? ist.ergebnis.raeume : [];
  const raeume = {
    kopf: ['Raum', ...sp.flatMap((s) => [`${s.name}: Heizlast`, 'Vorlauf'])],
    zeilen: raumListe.map((r) => [
      r.name,
      ...sp.flatMap((s) => {
        const e = s.ergebnis?.raeume.find((x) => x.id === r.id);
        const v = s.bewertung?.zeilen.find((x) => x.raumId === r.id);
        return [e ? watt(e.mittel.heizlast) : '–', v ? vorlaufText(v.vorlauf) : (e ? 'passiv' : '–')];
      }),
    ]),
    ausrichtung: `l${'rr'.repeat(sp.length)}`,
  };

  const verlustZeile = (name, id) => [
    name,
    ...sp.map((s, i) => {
      const w = s.verluste[id];
      if (i === 0) return watt(w);
      const d = w - ist.verluste[id];
      return `${watt(w)} (${Math.abs(d) < 0.5 ? '±0' : `${d > 0 ? '+' : '−'}${formatZahl(Math.abs(d), 0)}`} W)`;
    }),
  ];
  const sichtbar = VERLUST_ARTEN.filter((a) => sp.some((s) => Math.abs(s.verluste[a.id]) > 0.5));
  const transmission = {
    kopf: ['Verlust nach Art (Mittelwert)', ...sp.map((s) => s.name)],
    zeilen: [
      ...sichtbar.map((a) => verlustZeile(a.name, a.id)),
      ['Summe = Gebäudeheizlast', ...sp.map((s) => watt(summe(VERLUST_ARTEN.map((a) => s.verluste[a.id]))))],
    ],
    ausrichtung: `l${'r'.repeat(sp.length)}`,
    summenzeile: true,
  };
  return { kennzahlen, jahreswaerme, raeume, transmission, kopfmitName };
}
