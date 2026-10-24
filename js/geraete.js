// Geräteprüfung: Wärmepumpen aus dem Katalog gegen die Heizlast des Hauses prüfen. Reine Funktionen ohne Oberfläche.
//
// Zwei Stufen:
//   Stufe A „Vorauswahl“: nur BAFA-Werte. Verhältnis der BAFA-Nennleistung (55 °C) zur oberen Grenze der Gebäudeheizlast, grobe Einordnung.
//   Stufe B „Prüfung“: mit Datenblattpunkten (Außentemperatur, Vorlauftemperatur, maximale und minimale Heizleistung).
//                      Liegen Datenblattpunkte vor, ersetzt Stufe B die Vorauswahl.
// Je Kriterium eine Ampel mit kurzer Begründung. Es gibt keine Gesamtnote und keinen Sieger.
// Leistungen im Katalog und hier in kW, Temperaturen in °C.

import { formatZahl } from './engine/format.js';

const TOL = 1e-9;
export const MAX_EXTRAPOLATION_K = 3;

// Schwellen der Ampeln. Die Werte für Vorauswahl und Takt stammen aus der Aufgabenstellung, die Schwellen für Deckung und
// Bivalenzpunkt sind Annahmen der App und werden in der Oberfläche genannt.
export const SCHWELLEN = {
  vorauswahlGruen: [0.9, 1.3],
  vorauswahlGelb: [0.75, 1.6],
  deckungGruen: 100, // % der oberen Grenze
  deckungGelb: 85,
  bivalenzGelbBis: -5, // °C: Bivalenzpunkt höchstens so hoch ist gelb, höher ist rot
};

export const VORAUSWAHL_HINWEIS = 'Vorauswahl, nicht für die Auslegung. Die BAFA-Nennleistung bezieht sich auf eine Auslegung bei −10 °C (EU-Durchschnittsklima), nicht auf den Standort des Hauses.';
export const BAFA_HINWEIS = 'Die BAFA-Nennleistung ist kein Auslegungswert. Für die Prüfung die Heizleistung aus dem Datenblatt verwenden.';

const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const mitMinus = (x, stellen) => `${x < 0 ? '−' : ''}${formatZahl(Math.abs(x), stellen)}`;
const kW = (x, stellen = 2) => `${mitMinus(x, stellen)} kW`;
const grad = (t) => `${mitMinus(t, Number.isInteger(t) ? 0 : 1)} °C`;
const gleichT = (a, b) => Math.abs(a - b) < 0.01;

export const geraetName = (g) => [g.hersteller, g.modell].filter(Boolean).join(' ') || 'Wärmepumpe ohne Namen';

// --- Interpolation -----------------------------------------------------------------------------

// werte: [{ x, y }] mit verschiedenen x, aufsteigend. Linear zwischen den Punkten; außerhalb höchstens MAX_EXTRAPOLATION_K
// über den äußersten Punkt hinaus (mit der Steigung der beiden äußersten Punkte). Ein einzelner Punkt gilt nur an seiner Stelle.
export function interpoliere(werte, x) {
  if (werte.length === 0) return { ok: false, grund: 'keine Punkte' };
  if (werte.length === 1) {
    return Math.abs(werte[0].x - x) <= TOL ? { ok: true, wert: werte[0].y, extrapoliert: Boolean(werte[0].extrapoliert) } : { ok: false, grund: 'nur ein Punkt' };
  }
  const lo = werte[0].x;
  const hi = werte[werte.length - 1].x;
  if (x < lo - MAX_EXTRAPOLATION_K - TOL || x > hi + MAX_EXTRAPOLATION_K + TOL) return { ok: false, grund: 'außerhalb der Datenblattpunkte' };
  let i = werte.findIndex((w) => w.x >= x - TOL);
  if (i < 0) i = werte.length - 1;
  const [a, b] = i <= 0 ? [werte[0], werte[1]] : [werte[i - 1], werte[i]];
  const wert = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  // Als extrapoliert gilt auch ein Wert, der aus bereits extrapolierten Stützstellen entsteht.
  return { ok: true, wert, extrapoliert: x < lo - TOL || x > hi + TOL || Boolean(a.extrapoliert) || Boolean(b.extrapoliert) };
}

const punkteMitMax = (g) => (g.punkte ?? []).filter((p) => istZahl(p.aussen) && istZahl(p.vorlauf) && istZahl(p.max));

// Maximale Heizleistung je Außentemperatur bei der Vorlauftemperatur y: [{ x: Außentemperatur, y: kW, extrapoliert }].
// Je Außentemperatur wird über die Vorlauftemperatur interpoliert, Außentemperaturen ohne brauchbare Punkte entfallen.
export function leistungsStufen(g, vorlauf) {
  const nachAussen = new Map();
  for (const p of punkteMitMax(g)) {
    const schluessel = Math.round(p.aussen * 1000);
    if (!nachAussen.has(schluessel)) nachAussen.set(schluessel, { aussen: p.aussen, punkte: [] });
    const eintrag = nachAussen.get(schluessel);
    if (!eintrag.punkte.some((q) => Math.abs(q.x - p.vorlauf) <= TOL)) eintrag.punkte.push({ x: p.vorlauf, y: p.max });
  }
  const stufen = [];
  for (const { aussen, punkte } of nachAussen.values()) {
    const r = interpoliere(punkte.sort((a, b) => a.x - b.x), vorlauf);
    if (r.ok) stufen.push({ x: aussen, y: r.wert, extrapoliert: r.extrapoliert });
  }
  return stufen.sort((a, b) => a.x - b.x);
}

// Maximale Heizleistung bei Außentemperatur theta und Vorlauftemperatur vorlauf.
// Rückgabe { ok: true, kW, extrapoliert } oder { ok: false, grund }.
export function maxLeistung(g, theta, vorlauf) {
  const r = interpoliere(leistungsStufen(g, vorlauf), theta);
  if (!r.ok) return { ok: false, grund: 'Datenblattpunkte reichen nicht' };
  return { ok: true, kW: r.wert, extrapoliert: r.extrapoliert };
}

// --- Pflichtwerte ------------------------------------------------------------------------------

// Pflicht für die Prüfung: maximale Heizleistung bei A−7 mit W35 und W55 sowie ein Punkt mit minimaler Leistung bei A7 oder höher.
export function fehlendeWerte(g) {
  const punkte = punkteMitMax(g);
  const fehlend = [];
  if (!punkte.some((p) => gleichT(p.aussen, -7) && gleichT(p.vorlauf, 35))) fehlend.push('maximale Heizleistung bei A−7 / W35');
  if (!punkte.some((p) => gleichT(p.aussen, -7) && gleichT(p.vorlauf, 55))) fehlend.push('maximale Heizleistung bei A−7 / W55');
  if (!minimalPunkte(g).length) fehlend.push('minimale Heizleistung bei A7 oder höher');
  return fehlend;
}

const minimalPunkte = (g) => (g.punkte ?? []).filter((p) => istZahl(p.aussen) && p.aussen >= 7 - 0.01 && istZahl(p.min));
const hatDatenblatt = (g) => punkteMitMax(g).length > 0;

// --- Kriterien ---------------------------------------------------------------------------------

// Vorauswahl (Stufe A): BAFA-Nennleistung 55 °C geteilt durch die obere Grenze der Heizlast.
export function vorauswahl(nennleistung, obereKW) {
  const r = nennleistung / obereKW;
  const [gl, gh] = SCHWELLEN.vorauswahlGruen;
  const [yl, yh] = SCHWELLEN.vorauswahlGelb;
  const ampel = r >= gl - TOL && r <= gh + TOL ? 'gruen' : r >= yl - TOL && r <= yh + TOL ? 'gelb' : 'rot';
  return { verhaeltnis: r, ampel };
}

// Bivalenzpunkt: Außentemperatur, bei der die maximale Leistung (bei Vorlauf y) gleich der Heizlastlinie (obere Grenze) ist.
// linie: Ergebnis von heizlastLinie (hMax in W/K, thetaMittel). Unterhalb deckt ein Heizstab den Rest.
// Rückgabe { ok: true, art: 'kein_heizstab' | 'punkt' | 'kein_schnitt', theta, heizstab (kW bei thetaE), leistung, last (kW bei thetaE) }
// oder { ok: false, grund }.
export function bivalenz(g, vorlauf, linie, thetaE) {
  const hMax = linie.hMax / 1000;
  const last = (t) => hMax * Math.max(linie.thetaMittel - t, 0);
  const stufen = leistungsStufen(g, vorlauf);
  const p0 = maxLeistung(g, thetaE, vorlauf);
  if (!p0.ok) return { ok: false, grund: p0.grund };
  const l0 = last(thetaE);
  const ergebnis = { ok: true, leistung: p0.kW, last: l0, extrapoliert: p0.extrapoliert };
  if (p0.kW >= l0 - TOL) return { ...ergebnis, art: 'kein_heizstab', theta: null, heizstab: 0 };
  const heizstab = l0 - p0.kW;
  // Beide Kurven sind zwischen den Stützstellen linear: Nullstelle der Differenz in jedem Abschnitt suchen.
  const lo = stufen[0].x - MAX_EXTRAPOLATION_K;
  const hi = Math.min(stufen[stufen.length - 1].x + MAX_EXTRAPOLATION_K, linie.thetaMittel);
  const stuetz = [...new Set([thetaE, ...stufen.map((s) => s.x), lo, hi].filter((t) => t >= thetaE - TOL && t <= hi + TOL))].sort((a, b) => a - b);
  const d = (t) => { const p = maxLeistung(g, t, vorlauf); return p.ok ? p.kW - last(t) : null; };
  for (let i = 0; i < stuetz.length - 1; i += 1) {
    const [t1, t2] = [stuetz[i], stuetz[i + 1]];
    const [d1, d2] = [d(t1), d(t2)];
    if (d1 === null || d2 === null) continue;
    if (d1 < 0 && d2 >= 0) return { ...ergebnis, art: 'punkt', theta: t1 + ((0 - d1) * (t2 - t1)) / (d2 - d1), heizstab };
  }
  return { ...ergebnis, art: 'kein_schnitt', theta: null, heizstab };
}

// Taktprüfung: kleinste Leistung gegen die untere Grenze der Heizlast bei +7 °C, +2 °C und +12 °C.
// Grün: minimale Leistung höchstens so groß wie die Heizlast bei +7 °C; gelb: nur bis +2 °C; rot sonst.
// Als minimale Leistung gilt der Punkt bei A7 oder höher, dessen Vorlauftemperatur der nötigen am nächsten liegt (ohne Vorlauf: der kleinste).
export function takt(g, linie, vorlauf = null) {
  const punkte = minimalPunkte(g);
  if (punkte.length === 0) return { ok: false, grund: 'minimale Heizleistung bei A7 oder höher' };
  const abstand = (p) => (istZahl(vorlauf) && istZahl(p.vorlauf) ? Math.abs(p.vorlauf - vorlauf) : 0);
  const punkt = punkte.reduce((a, b) => (abstand(b) < abstand(a) || (abstand(b) === abstand(a) && b.min < a.min) ? b : a));
  const hMin = linie.hMin / 1000;
  const last = (t) => hMin * Math.max(linie.thetaMittel - t, 0);
  const l7 = last(7);
  const l2 = last(2);
  const l12 = last(12);
  const ampel = punkt.min <= l7 + TOL ? 'gruen' : punkt.min <= l2 + TOL ? 'gelb' : 'rot';
  return { ok: true, min: punkt.min, punkt, l7, l2, l12, ampel };
}

// ETAs (Raumheizungs-Jahresnutzungsgrad) bei der Vorlauftemperatur: linear zwischen 35 und 55 °C, außerhalb höchstens 3 K.
export function effizienz(g, vorlauf) {
  const e35 = g.bafa?.eta35;
  const e55 = g.bafa?.eta55;
  if (!istZahl(e35) || !istZahl(e55)) return { ok: false, grund: `ETAs bei 35 und 55 °C` };
  const r = interpoliere([{ x: 35, y: e35 }, { x: 55, y: e55 }], vorlauf);
  if (!r.ok) return { ok: false, grund: 'Vorlauftemperatur liegt mehr als 3 K außerhalb von 35 bis 55 °C' };
  return { ok: true, eta: r.wert, extrapoliert: r.extrapoliert };
}

// --- Prüfung eines Geräts ----------------------------------------------------------------------

// Kontext aus dem Ergebnis (ergebnis.js, baueErgebnis): obere Grenze, Normaußentemperatur, nötiger Vorlauf Y und Heizlastlinie.
export function kontextAusErgebnis(erg) {
  if (!erg?.hatErgebnis) return null;
  const v = erg.waermepumpe.vorlauf;
  return {
    obereKW: erg.obere / 1000,
    thetaE: erg.thetaAussen,
    vorlauf: v.art === 'ok' ? v.grad : null,
    vorlaufGrund: v.art === 'ok' ? null : v.text,
    linie: erg.linie.ok ? erg.linie : null,
    linieGrund: erg.linie.ok ? null : erg.linie.grund,
  };
}

const nichtPruefbar = (id, name, fehlt) => ({
  id, name, ampel: 'grau', wert: 'nicht prüfbar', text: `nicht prüfbar: ${fehlt.join(', ')}`, sort: null,
});

// Prüft ein Gerät. Rückgabe { geraet, stufe: 'B' | 'A' | 'keine', kriterien, fehlend, hinweis }.
// Effizienz und Schall bekommen ihre Ampel erst im Vergleich der Geräte (pruefeListe).
export function pruefeGeraet(g, k) {
  const stufe = hatDatenblatt(g) ? 'B' : istZahl(g.bafa?.nennleistung55) ? 'A' : 'keine';
  const kriterien = [];
  const fehlend = stufe === 'B' ? fehlendeWerte(g) : [];
  const yFehlt = k.vorlauf === null ? [k.vorlaufGrund ?? 'nötige Vorlauftemperatur'] : [];

  if (stufe === 'A') {
    const v = vorauswahl(g.bafa.nennleistung55, k.obereKW);
    kriterien.push({
      id: 'vorauswahl', name: 'Vorauswahl (BAFA-Nennleistung 55 °C)', ampel: v.ampel, wert: `Verhältnis ${formatZahl(v.verhaeltnis, 2)}`,
      text: `${kW(g.bafa.nennleistung55, 1)} BAFA-Nennleistung zu ${kW(k.obereKW, 1)} obere Grenze der Heizlast. Grün 0,9 bis 1,3, gelb 0,75 bis 0,9 oder 1,3 bis 1,6, sonst rot.`,
      sort: Math.abs(v.verhaeltnis - 1.1),
    });
  }

  if (stufe === 'B') {
    const bedarfMax = [...yFehlt, ...fehlend.filter((f) => f.startsWith('maximale'))];
    // Deckung bei Auslegung
    if (bedarfMax.length > 0) {
      kriterien.push(nichtPruefbar('deckung', 'Deckung bei Auslegung', bedarfMax));
      kriterien.push(nichtPruefbar('bivalenz', 'Bivalenzpunkt', bedarfMax));
    } else if (!k.linie) {
      kriterien.push(nichtPruefbar('deckung', 'Deckung bei Auslegung', [k.linieGrund ?? 'Heizlastlinie']));
      kriterien.push(nichtPruefbar('bivalenz', 'Bivalenzpunkt', [k.linieGrund ?? 'Heizlastlinie']));
    } else {
      const p = maxLeistung(g, k.thetaE, k.vorlauf);
      if (!p.ok) {
        kriterien.push({ ...nichtPruefbar('deckung', 'Deckung bei Auslegung', []), text: `Datenblattpunkte reichen nicht: bei ${grad(k.thetaE)} und ${grad(k.vorlauf)} Vorlauf liegt keine Leistung innerhalb von ${MAX_EXTRAPOLATION_K} K um die Punkte.` });
        kriterien.push({ ...nichtPruefbar('bivalenz', 'Bivalenzpunkt', []), text: 'Datenblattpunkte reichen nicht.' });
      } else {
        const deckung = (p.kW / k.obereKW) * 100;
        const ampel = deckung >= SCHWELLEN.deckungGruen - TOL ? 'gruen' : deckung >= SCHWELLEN.deckungGelb ? 'gelb' : 'rot';
        kriterien.push({
          id: 'deckung', name: 'Deckung bei Auslegung', ampel, wert: `${formatZahl(deckung, 1)} %`, sort: -deckung,
          text: `${kW(p.kW)} maximal bei ${grad(k.thetaE)} und ${grad(k.vorlauf)} Vorlauf${p.extrapoliert ? ' (bis 3 K über die Datenblattpunkte hinaus fortgesetzt)' : ''}, obere Grenze der Heizlast ${kW(k.obereKW)}. Grün ab 100 %, gelb ab 85 %.`,
        });
        const b = bivalenz(g, k.vorlauf, k.linie, k.thetaE);
        if (!b.ok) {
          kriterien.push({ ...nichtPruefbar('bivalenz', 'Bivalenzpunkt', []), text: 'Datenblattpunkte reichen nicht.' });
        } else if (b.art === 'kein_heizstab') {
          kriterien.push({ id: 'bivalenz', name: 'Bivalenzpunkt', ampel: 'gruen', wert: `unter ${grad(k.thetaE)}`, sort: -1000, text: `Kein Heizstab nötig: Die Leistung reicht bis ${grad(k.thetaE)}.` });
        } else if (b.art === 'punkt') {
          const ampel2 = b.theta <= SCHWELLEN.bivalenzGelbBis ? 'gelb' : 'rot';
          kriterien.push({
            id: 'bivalenz', name: 'Bivalenzpunkt', ampel: ampel2, wert: grad(Math.round(b.theta * 10) / 10), sort: b.theta,
            text: `Unterhalb von ${grad(Math.round(b.theta * 10) / 10)} deckt ein Heizstab den Rest, bei ${grad(k.thetaE)} sind es ${kW(b.heizstab)}. Gelb bis −5 °C, darüber rot.`,
          });
        } else {
          kriterien.push({ id: 'bivalenz', name: 'Bivalenzpunkt', ampel: 'rot', wert: 'nicht erreicht', sort: 1000, text: `Die Leistung erreicht die Heizlastlinie im Bereich der Datenblattpunkte nicht. Bei ${grad(k.thetaE)} fehlen ${kW(b.heizstab)}.` });
        }
      }
    }
    // Takt
    const t = k.linie ? takt(g, k.linie, k.vorlauf) : { ok: false, grund: k.linieGrund ?? 'Heizlastlinie' };
    if (!t.ok) kriterien.push(nichtPruefbar('takt', 'Taktprüfung', [t.grund]));
    else {
      const text = `Minimale Leistung ${kW(t.min)} (A${t.punkt.aussen}/W${t.punkt.vorlauf}) gegen die Heizlast (untere Grenze): ${kW(t.l7)} bei +7 °C, ${kW(t.l2)} bei +2 °C, ${kW(t.l12)} bei +12 °C. `
        + 'Grün, wenn die minimale Leistung höchstens die Heizlast bei +7 °C beträgt, gelb bis +2 °C, sonst rot.';
      kriterien.push({ id: 'takt', name: 'Taktprüfung', ampel: t.ampel, wert: `${kW(t.min)} min.`, text, sort: t.min - t.l7 });
    }
  }

  // Effizienz und Schall gelten für beide Stufen, soweit die Werte da sind
  const e = k.vorlauf === null ? { ok: false, grund: k.vorlaufGrund ?? 'nötige Vorlauftemperatur' } : effizienz(g, k.vorlauf);
  if (e.ok) kriterien.push({ id: 'effizienz', name: 'Effizienz (ETAs bei nötigem Vorlauf)', ampel: 'grau', wert: `${formatZahl(e.eta, 0)} %`, text: `Linear zwischen ETAs 35 °C und 55 °C bei ${grad(k.vorlauf)} Vorlauf.`, sort: -e.eta, relativ: 'hoch' });
  else kriterien.push(nichtPruefbar('effizienz', 'Effizienz (ETAs bei nötigem Vorlauf)', [e.grund]));
  if (istZahl(g.schall)) kriterien.push({ id: 'schall', name: 'Schall (Außengerät)', ampel: 'grau', wert: `${formatZahl(g.schall, 0)} dB(A)`, text: 'Schallleistungspegel laut Katalog.', sort: g.schall, relativ: 'niedrig' });
  else kriterien.push(nichtPruefbar('schall', 'Schall (Außengerät)', ['Schallleistungspegel']));

  return {
    geraet: g, name: geraetName(g), stufe, kriterien,
    fehlend,
    hinweis: stufe === 'A' ? VORAUSWAHL_HINWEIS : stufe === 'keine' ? 'Weder Datenblattpunkte noch BAFA-Nennleistung vorhanden: nur ablegen, nicht prüfbar.' : null,
  };
}

// Schall und Effizienz lassen sich nur untereinander vergleichen: bester Wert grün, schlechtester rot, dazwischen gelb.
// Mit nur einem Gerät oder gleichen Werten bleibt die Ampel neutral.
function vergleicheUntereinander(ergebnisse) {
  for (const id of ['effizienz', 'schall']) {
    const mit = ergebnisse.map((r) => r.kriterien.find((c) => c.id === id)).filter((c) => c && c.sort !== null);
    if (mit.length < 2) {
      for (const c of mit) c.text += ' Nur Vergleich untereinander: mit nur einem Gerät keine Einordnung.';
      continue;
    }
    const beste = Math.min(...mit.map((c) => c.sort));
    const schlechteste = Math.max(...mit.map((c) => c.sort));
    for (const c of mit) {
      c.text += ' Nur Vergleich der Geräte untereinander.';
      if (beste === schlechteste) continue;
      c.ampel = c.sort === beste ? 'gruen' : c.sort === schlechteste ? 'rot' : 'gelb';
    }
  }
}

const STUFEN_REIHENFOLGE = { B: 0, A: 1, keine: 2 };

// Alle Geräte prüfen. Standardreihenfolge: zuerst geprüfte (Stufe B), dann vorausgewählte (Stufe A), dann Geräte ohne Werte, je nach Name.
// sortierung: 'stufe' (Standard) | 'name' | Kriterium ('deckung', 'bivalenz', 'takt', 'effizienz', 'schall', 'vorauswahl'): das beste zuerst,
// nicht prüfbare zuletzt.
export function pruefeListe(geraete, k, sortierung = 'stufe') {
  const ergebnisse = geraete.map((g) => pruefeGeraet(g, k));
  vergleicheUntereinander(ergebnisse);
  const nachName = (a, b) => a.name.localeCompare(b.name, 'de');
  const nachStufe = (a, b) => STUFEN_REIHENFOLGE[a.stufe] - STUFEN_REIHENFOLGE[b.stufe] || nachName(a, b);
  if (sortierung === 'name') return ergebnisse.sort(nachName);
  if (sortierung === 'stufe') return ergebnisse.sort(nachStufe);
  const wert = (r) => r.kriterien.find((c) => c.id === sortierung)?.sort ?? null;
  return ergebnisse.sort((a, b) => {
    const [x, y] = [wert(a), wert(b)];
    if (x === null && y === null) return nachStufe(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y || nachStufe(a, b);
  });
}

export const SORTIERUNGEN = [
  { id: 'stufe', text: 'Prüfstufe (geprüft, dann vorausgewählt)' },
  { id: 'deckung', text: 'Deckung bei Auslegung' },
  { id: 'bivalenz', text: 'Bivalenzpunkt (tiefster zuerst)' },
  { id: 'takt', text: 'Taktprüfung' },
  { id: 'effizienz', text: 'Effizienz' },
  { id: 'schall', text: 'Schall (leisester zuerst)' },
  { id: 'name', text: 'Name' },
];
