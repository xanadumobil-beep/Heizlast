// Szenarienvergleich: rechnet den Ist-Zustand und jedes Szenario durch und baut die Vergleichstabellen.
// Reine Funktionen ohne Oberfläche. Bildschirm und Bericht nutzen dieselben Tabellen.

import { formatZahl } from './engine/format.js';
import { rechne, bewerteVorlauf } from './daten.js';
import { wendeSzenarioAn } from './szenario.js';
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
export function baueVergleich(ist, szenarien) {
  const basis = { id: null, name: 'Ist-Zustand', szenario: null, szenarioHinweise: [], ...berechneAnsicht(ist) };
  const spalten = [basis];
  for (const s of szenarien) {
    const { projekt, hinweise } = wendeSzenarioAn(ist, s);
    const a = berechneAnsicht(projekt);
    spalten.push({ id: s.id, name: s.name, szenario: s, szenarioHinweise: hinweise, ...a });
  }
  for (const sp of spalten) {
    sp.minderungW = basis.mittel !== null && sp.mittel !== null ? basis.mittel - sp.mittel : null;
    sp.minderungProzent = sp.minderungW !== null && basis.mittel > 0 ? (sp.minderungW / basis.mittel) * 100 : null;
  }
  return { spalten };
}

// --- Texte -----------------------------------------------------------------------------------

const mitMinus = (x, stellen) => `${x < 0 ? '−' : ''}${formatZahl(Math.abs(x), stellen)}`;

// Minderung gegenüber dem Ist-Zustand (Mittelwert): positiv heißt weniger Heizlast, negativ heißt Mehrbedarf.
export function minderungText(sp) {
  if (sp.id === null) return '–';
  if (sp.minderungW === null) return 'nicht berechenbar';
  return `${mitMinus(sp.minderungW / 1000, 2)} kW (${sp.minderungProzent === null ? '–' : `${mitMinus(sp.minderungProzent, 1)} %`})`;
}

function vorlaufHausText(sp) {
  if (!sp.bestimmend) return sp.bewertung ? 'nicht bestimmbar' : '–';
  return `${vorlaufText(sp.bestimmend.vorlauf)} (${sp.bestimmend.name})`;
}

// Tabellen für Bildschirm und Bericht: { kopf, zeilen } mit Zeichenketten.
export function vergleichTabellen(vergleich) {
  const sp = vergleich.spalten;
  const kopfmitName = ['', ...sp.map((s) => s.name)];
  const kennzahlen = {
    kopf: ['Kennzahl', ...sp.map((s) => s.name)],
    zeilen: [
      ['Gebäudeheizlast (günstig bis ungünstig)', ...sp.map((s) => (s.bandbreite ? wattBereich(s.bandbreite.min, s.bandbreite.max) : s.fehler ? 'Rechenfehler' : '–'))],
      ['Gebäudeheizlast, Mittelwert', ...sp.map((s) => (s.mittel !== null ? watt(s.mittel) : '–'))],
      ['Minderung gegenüber Ist-Zustand (Mittelwert, negativ = Mehrbedarf)', ...sp.map(minderungText)],
      ['Nötige Vorlauftemperatur des Hauses (bestimmender Raum)', ...sp.map(vorlaufHausText)],
      ['Ziel-Vorlauftemperatur', ...sp.map((s) => `${formatZahl(s.ziel, 0)} °C`)],
      ['Räume mit Unterdeckung bei der Ziel-Vorlauftemperatur', ...sp.map((s) => (s.bewertung ? `${s.raeumeMitUnterdeckung} von ${s.raeumeBewertet}${s.raeumeOhneBewertung > 0 ? ` (${s.raeumeOhneBewertung} ohne Bewertung)` : ''}` : '–'))],
      ['Hinweise zu den Abweichungen', ...sp.map((s) => (s.id === null ? '–' : s.szenarioHinweise.length === 0 ? 'keine' : `${s.szenarioHinweise.length}`))],
    ],
    ausrichtung: `l${'l'.repeat(sp.length)}`,
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
  return { kennzahlen, raeume, transmission, kopfmitName };
}
