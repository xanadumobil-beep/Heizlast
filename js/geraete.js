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

// Grenzen der Vorauswahl (fest). Verhältnis BAFA-Nennleistung 55 °C zur oberen Grenze der Heizlast.
export const VORAUSWAHL_GRENZEN = { gruen: [0.9, 1.3], gelb: [0.75, 1.6] };

// Ampelgrenzen von Bivalenzpunkt und Deckung: einstellbar unter Grundlagen → Rechenannahmen (einstellungen.geraetepruefung).
//   Bivalenzpunkt: grün bis bivalenzGruen °C, gelb bis bivalenzGelb °C, darüber rot.
//   Deckung bei θ_e: grün ab deckungGruen %, gelb ab deckungGelb %, darunter rot.
export const STANDARD_SCHWELLEN = { bivalenzGruen: -4, bivalenzGelb: -1, deckungGruen: 80, deckungGelb: 65 };

export function schwellen(einstellungen) {
  const e = einstellungen?.geraetepruefung ?? {};
  return Object.fromEntries(Object.entries(STANDARD_SCHWELLEN).map(([k, v]) => [k, typeof e[k] === 'number' && Number.isFinite(e[k]) ? e[k] : v]));
}

export const BIVALENZ_HINWEIS = 'Ein Bivalenzpunkt um −5 °C ist bei monoenergetischen Luft-Wasser-Wärmepumpen üblich. Ein Gerät ohne Heizstabbedarf bis zur Normaußentemperatur ist meist überdimensioniert und taktet in der Übergangszeit.';
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

const punkteMit = (g, feld) => (g.punkte ?? []).filter((p) => istZahl(p.aussen) && istZahl(p.vorlauf) && istZahl(p[feld]));
const punkteMitMax = (g) => punkteMit(g, 'max');

// Maximale Heizleistung je Außentemperatur bei der Vorlauftemperatur y: [{ x: Außentemperatur, y: kW, extrapoliert }].
// Je Außentemperatur wird über die Vorlauftemperatur interpoliert, Außentemperaturen ohne brauchbare Punkte entfallen.
export function leistungsStufen(g, vorlauf, feld = 'max') {
  const nachAussen = new Map();
  for (const p of punkteMit(g, feld)) {
    const schluessel = Math.round(p.aussen * 1000);
    if (!nachAussen.has(schluessel)) nachAussen.set(schluessel, { aussen: p.aussen, punkte: [] });
    const eintrag = nachAussen.get(schluessel);
    if (!eintrag.punkte.some((q) => Math.abs(q.x - p.vorlauf) <= TOL)) eintrag.punkte.push({ x: p.vorlauf, y: p[feld] });
  }
  const stufen = [];
  for (const { aussen, punkte } of nachAussen.values()) {
    const r = interpoliere(punkte.sort((a, b) => a.x - b.x), vorlauf);
    if (r.ok) stufen.push({ x: aussen, y: r.wert, extrapoliert: r.extrapoliert });
  }
  return stufen.sort((a, b) => a.x - b.x);
}

// Leistung (feld 'max' oder 'min') bei Außentemperatur theta und Vorlauftemperatur vorlauf. Die Regeln sind für beide gleich.
// Rückgabe { ok: true, kW, extrapoliert } oder { ok: false, grund }.
export function leistung(g, theta, vorlauf, feld = 'max') {
  const r = interpoliere(leistungsStufen(g, vorlauf, feld), theta);
  if (!r.ok) return { ok: false, grund: 'Datenblattpunkte reichen nicht' };
  return { ok: true, kW: r.wert, extrapoliert: r.extrapoliert };
}
export const maxLeistung = (g, theta, vorlauf) => leistung(g, theta, vorlauf, 'max');
export const minLeistung = (g, theta, vorlauf) => leistung(g, theta, vorlauf, 'min');

// Datenblattpunkt mit der kleinsten Entfernung (Summe der Beträge der Abweichungen von Außen- und Vorlauftemperatur).
function naechsterPunkt(g, theta, vorlauf, feld) {
  const punkte = punkteMit(g, feld);
  if (punkte.length === 0) return null;
  const abstand = (p) => Math.abs(p.aussen - theta) + Math.abs(p.vorlauf - vorlauf);
  return punkte.reduce((a, b) => (abstand(b) < abstand(a) - TOL || (Math.abs(abstand(b) - abstand(a)) <= TOL && b[feld] < a[feld]) ? b : a));
}

// Heizkurve: Vorlauftemperatur bei Außentemperatur theta, linear von θ_soll,Mittel (bei theta = θ_soll,Mittel) bis Y (bei θ_e), mindestens 25 °C.
//   t_V(θ) = θ_soll + (Y − θ_soll) · (θ_soll − θ) / (θ_soll − θ_e)
export const HEIZKURVE_MIN = 25;
export function heizkurve(thetaSoll, thetaE, vorlaufY, theta) {
  return Math.max(HEIZKURVE_MIN, thetaSoll + ((vorlaufY - thetaSoll) * (thetaSoll - theta)) / (thetaSoll - thetaE));
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
  const [gl, gh] = VORAUSWAHL_GRENZEN.gruen;
  const [yl, yh] = VORAUSWAHL_GRENZEN.gelb;
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

const bivalenzAmpel = (theta, sw) => (theta <= sw.bivalenzGruen + TOL ? 'gruen' : theta <= sw.bivalenzGelb + TOL ? 'gelb' : 'rot');
const deckungAmpel = (prozent, sw) => (prozent >= sw.deckungGruen - TOL ? 'gruen' : prozent >= sw.deckungGelb - TOL ? 'gelb' : 'rot');

// Taktprüfung: kleinste Leistung gegen die untere Grenze der Heizlast bei +7 °C und +2 °C (und zur Information +12 °C).
// Die Vorlauftemperatur je Außentemperatur kommt aus der Heizkurve (heizkurve, Y = nötiger Vorlauf bei θ_e). Die minimale Leistung wird
// bei diesem Vorlauf aus den Datenblattpunkten interpoliert (gleiche Regeln wie bei der maximalen Leistung). Gibt es keinen passenden Punkt,
// gilt der nächstliegende Datenblattpunkt, das steht im Ergebnis (quelle 'naechster').
// Ohne bekannten Vorlauf Y gilt der kleinste Wert bei A7 oder höher (quelle 'kleinster').
// Grün: minimale Leistung bei +7 °C höchstens so groß wie die Heizlast bei +7 °C; gelb: nur bis +2 °C (minimale Leistung bei +2 °C
// höchstens die Heizlast bei +2 °C); sonst rot.
export function takt(g, linie, vorlaufY = null, thetaE = linie.thetaAussen) {
  const warm = (g.punkte ?? []).filter((p) => istZahl(p.aussen) && p.aussen >= 7 - 0.01 && istZahl(p.min));
  if (warm.length === 0) return { ok: false, grund: 'minimale Heizleistung bei A7 oder höher' };
  const hMin = linie.hMin / 1000;
  const last = (t) => hMin * Math.max(linie.thetaMittel - t, 0);
  const bei = (theta) => {
    if (!istZahl(vorlaufY)) {
      const p = warm.reduce((a, b) => (b.min < a.min ? b : a));
      return { theta, kW: p.min, quelle: 'kleinster', punkt: p, vorlauf: null };
    }
    const tv = heizkurve(linie.thetaMittel, thetaE, vorlaufY, theta);
    const r = minLeistung(g, theta, tv);
    if (r.ok) return { theta, kW: r.kW, quelle: 'interpoliert', extrapoliert: r.extrapoliert, vorlauf: tv };
    const p = naechsterPunkt(g, theta, tv, 'min');
    return { theta, kW: p.min, quelle: 'naechster', punkt: p, vorlauf: tv };
  };
  const m7 = bei(7);
  const m2 = bei(2);
  const m12 = bei(12);
  const [l7, l2, l12] = [last(7), last(2), last(12)];
  const ampel = m7.kW <= l7 + TOL ? 'gruen' : m2.kW <= l2 + TOL ? 'gelb' : 'rot';
  return { ok: true, min: m7.kW, m7, m2, m12, l7, l2, l12, ampel };
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
    schwellen: erg.schwellen ?? STANDARD_SCHWELLEN,
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
    const sw = k.schwellen ?? STANDARD_SCHWELLEN;
    const bedarfMax = [...yFehlt, ...fehlend.filter((f) => f.startsWith('maximale'))];
    // Deckung bei Auslegung
    if (bedarfMax.length > 0) {
      kriterien.push(nichtPruefbar('deckung', `Deckung bei ${grad(k.thetaE)}`, bedarfMax));
      kriterien.push(nichtPruefbar('bivalenz', 'Bivalenzpunkt', bedarfMax));
    } else if (!k.linie) {
      kriterien.push(nichtPruefbar('deckung', `Deckung bei ${grad(k.thetaE)}`, [k.linieGrund ?? 'Heizlastlinie']));
      kriterien.push(nichtPruefbar('bivalenz', 'Bivalenzpunkt', [k.linieGrund ?? 'Heizlastlinie']));
    } else {
      const p = maxLeistung(g, k.thetaE, k.vorlauf);
      if (!p.ok) {
        kriterien.push({ ...nichtPruefbar('deckung', `Deckung bei ${grad(k.thetaE)}`, []), text: `Datenblattpunkte reichen nicht: bei ${grad(k.thetaE)} und ${grad(k.vorlauf)} Vorlauf liegt keine Leistung innerhalb von ${MAX_EXTRAPOLATION_K} K um die Punkte.` });
        kriterien.push({ ...nichtPruefbar('bivalenz', 'Bivalenzpunkt', []), text: 'Datenblattpunkte reichen nicht.' });
      } else {
        const deckung = (p.kW / k.obereKW) * 100;
        kriterien.push({
          id: 'deckung', name: `Deckung bei ${grad(k.thetaE)}`, ampel: deckungAmpel(deckung, sw), wert: `${formatZahl(deckung, 1)} %`, sort: -deckung,
          text: `${kW(p.kW)} maximal bei ${grad(k.thetaE)} und ${grad(k.vorlauf)} Vorlauf${p.extrapoliert ? ' (bis 3 K über die Datenblattpunkte hinaus fortgesetzt)' : ''}, obere Grenze der Heizlast ${kW(k.obereKW)}. Grün ab ${formatZahl(sw.deckungGruen, 0)} %, gelb ab ${formatZahl(sw.deckungGelb, 0)} %.`,
        });
        const b = bivalenz(g, k.vorlauf, k.linie, k.thetaE);
        const grenzen = `Grün bis ${grad(sw.bivalenzGruen)}, gelb bis ${grad(sw.bivalenzGelb)}, darüber rot.`;
        if (!b.ok) {
          kriterien.push({ ...nichtPruefbar('bivalenz', 'Bivalenzpunkt', []), text: 'Datenblattpunkte reichen nicht.' });
        } else if (b.art === 'kein_heizstab') {
          kriterien.push({
            id: 'bivalenz', name: 'Bivalenzpunkt', ampel: bivalenzAmpel(k.thetaE, sw), wert: `unter ${grad(k.thetaE)}`, sort: -1000,
            text: `Kein Heizstab nötig: Die Leistung reicht bis ${grad(k.thetaE)}. Ein Gerät ohne Heizstabbedarf bis zur Normaußentemperatur ist meist überdimensioniert und taktet in der Übergangszeit, siehe Taktprüfung. ${grenzen}`,
          });
        } else if (b.art === 'punkt') {
          const gerundet = Math.round(b.theta * 10) / 10;
          kriterien.push({
            id: 'bivalenz', name: 'Bivalenzpunkt', ampel: bivalenzAmpel(b.theta, sw), wert: grad(gerundet), sort: b.theta,
            text: `Unterhalb von ${grad(gerundet)} deckt ein Heizstab den Rest, bei ${grad(k.thetaE)} sind es ${kW(b.heizstab)}. ${grenzen}`,
          });
        } else {
          kriterien.push({ id: 'bivalenz', name: 'Bivalenzpunkt', ampel: 'rot', wert: 'nicht erreicht', sort: 1000, text: `Die Leistung erreicht die Heizlastlinie im Bereich der Datenblattpunkte nicht. Bei ${grad(k.thetaE)} fehlen ${kW(b.heizstab)}.` });
        }
      }
    }
    // Takt
    const t = k.linie ? takt(g, k.linie, k.vorlauf, k.thetaE) : { ok: false, grund: k.linieGrund ?? 'Heizlastlinie' };
    if (!t.ok) kriterien.push(nichtPruefbar('takt', 'Taktprüfung', [t.grund]));
    else {
      const quelle = (m) => (m.quelle === 'interpoliert' ? `bei ${grad(Math.round(m.vorlauf * 10) / 10)} Vorlauf (Heizkurve) interpoliert${m.extrapoliert ? ', bis 3 K fortgesetzt' : ''}`
        : m.quelle === 'naechster' ? `kein passender Punkt für ${grad(Math.round(m.vorlauf * 10) / 10)} Vorlauf, nächstliegender Datenblattpunkt A${m.punkt.aussen}/W${m.punkt.vorlauf} genommen`
          : 'ohne nötigen Vorlauf: kleinster Wert bei A7 oder höher');
      const zeile = (m, l) => `${m.theta > 0 ? '+' : ''}${grad(m.theta)}: ${kW(m.kW)} (${quelle(m)}) gegen Heizlast ${kW(l)}`;
      const text = `Minimale Leistung gegen die Heizlast (untere Grenze). ${zeile(t.m7, t.l7)}. ${zeile(t.m2, t.l2)}. ${zeile(t.m12, t.l12)}. `
        + 'Grün, wenn die minimale Leistung bei +7 °C höchstens die Heizlast bei +7 °C beträgt, gelb, wenn das erst bei +2 °C gilt, sonst rot.';
      kriterien.push({ id: 'takt', name: 'Taktprüfung', ampel: t.ampel, wert: `${kW(t.m7.kW)} min. bei +7 °C`, text, sort: t.m7.kW - t.l7 });
    }
  }

  // Effizienz und Schall gelten für beide Stufen, soweit die Werte da sind
  const e = k.vorlauf === null ? { ok: false, grund: k.vorlaufGrund ?? 'nötige Vorlauftemperatur' } : effizienz(g, k.vorlauf);
  if (e.ok) kriterien.push({ id: 'effizienz', name: 'Effizienz (ETAs bei nötigem Vorlauf)', ampel: 'grau', wert: `${formatZahl(e.eta, 0)} %`, text: `Linear zwischen ETAs 35 °C und 55 °C bei ${grad(k.vorlauf)} Vorlauf.`, sort: -e.eta, rangfolge: true });
  else kriterien.push(nichtPruefbar('effizienz', 'Effizienz (ETAs bei nötigem Vorlauf)', [e.grund]));
  if (istZahl(g.schall)) kriterien.push({ id: 'schall', name: 'Schall (Außengerät)', ampel: 'grau', wert: `${formatZahl(g.schall, 0)} dB(A)`, text: 'Schallleistungspegel laut Katalog.', sort: g.schall, rangfolge: true });
  else kriterien.push(nichtPruefbar('schall', 'Schall (Außengerät)', ['Schallleistungspegel']));

  return {
    geraet: g, name: geraetName(g), stufe, kriterien,
    fehlend,
    hinweis: stufe === 'A' ? VORAUSWAHL_HINWEIS : stufe === 'keine' ? 'Weder Datenblattpunkte noch BAFA-Nennleistung vorhanden: nur ablegen, nicht prüfbar.' : null,
  };
}

// Schall und Effizienz lassen sich nur untereinander vergleichen: Die Ampel ist eine Rangfolge (bester Wert grün, schlechtester rot,
// dazwischen gelb), daneben steht immer der echte Wert. Mit nur einem Gerät oder gleichen Werten bleibt die Ampel neutral.
function vergleicheUntereinander(ergebnisse) {
  for (const id of ['effizienz', 'schall']) {
    const mit = ergebnisse.map((r) => r.kriterien.find((c) => c.id === id)).filter((c) => c && c.sort !== null);
    if (mit.length < 2) {
      for (const c of mit) c.text += ' Rangfolge: mit nur einem Gerät keine Einordnung.';
      continue;
    }
    const beste = Math.min(...mit.map((c) => c.sort));
    const schlechteste = Math.max(...mit.map((c) => c.sort));
    for (const c of mit) {
      c.rang = `Rang ${1 + mit.filter((x) => x.sort < c.sort).length} von ${mit.length}`;
      c.text += ' Die Ampel ist eine Rangfolge der Geräte untereinander, kein Maßstab.';
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

// --- Bericht -------------------------------------------------------------------------------------

const AMPEL_WORT = { gruen: 'grün', gelb: 'gelb', rot: 'rot', grau: 'neutral' };
export const STUFE_TEXT = { B: 'Prüfung (Stufe B)', A: 'Vorauswahl (Stufe A)', keine: 'keine Werte' };

// Blöcke für eine eigene Berichtsseite: alle Katalog-Geräte, geprüfte vor vorausgewählten. erg: Ergebnis aus baueErgebnis (ergebnis.js).
export function geraetepruefungBloecke(erg, katalog, sortierung = 'stufe') {
  const text = (t) => ({ art: 'text', text: t });
  const box = (t, stufe = 'hinweis') => ({ art: 'box', text: t, stufe });
  const zwischentitel = (t) => ({ art: 'zwischentitel', text: t });
  const k = kontextAusErgebnis(erg);
  const bloecke = [text('Wärmepumpen aus dem Katalog gegen die Heizlast. Je Kriterium eine Ampel mit Begründung, keine Gesamtnote und kein Sieger. Geprüfte Geräte (mit Datenblattpunkten) stehen vor vorausgewählten (nur BAFA-Werte).')];
  if (!k) return [...bloecke, box('Ohne berechenbare Heizlast lässt sich kein Gerät prüfen.', 'fehler')];
  bloecke.push(text(`Geprüft gegen: obere Grenze ${kW(k.obereKW)} bei ${grad(k.thetaE)}, `
    + (k.vorlauf === null ? `nötiger Vorlauf nicht bestimmbar (${k.vorlaufGrund}).` : `nötiger Vorlauf ${formatZahl(k.vorlauf, 1)} °C.`)));
  for (const r of pruefeListe(katalog, k, sortierung)) {
    bloecke.push(zwischentitel(`${r.name}: ${STUFE_TEXT[r.stufe]}`));
    if (r.hinweis) bloecke.push(box(r.hinweis));
    if (r.fehlend.length > 0) bloecke.push(box(`Nicht prüfbar: ${r.fehlend.join(', ')}`, 'fehler'));
    bloecke.push({
      art: 'tabelle', kopf: ['Kriterium', 'Ampel', 'Wert', 'Begründung'], ausrichtung: 'llll', summenzeile: false, hervor: [],
      zeilen: r.kriterien.map((c) => [c.name, `${AMPEL_WORT[c.ampel]}${c.rangfolge && c.rang ? ' (Rangfolge)' : ''}`, `${c.wert}${c.rang ? ` · ${c.rang}` : ''}`, c.text]),
    });
  }
  if (katalog.length === 0) bloecke.push(text('Der Katalog ist leer.'));
  const sw = k.schwellen;
  bloecke.push(zwischentitel('Grenzen der Ampeln'));
  bloecke.push({
    art: 'liste',
    eintraege: [
      `Deckung bei ${grad(k.thetaE)}: grün ab ${formatZahl(sw.deckungGruen, 0)} %, gelb ab ${formatZahl(sw.deckungGelb, 0)} %, sonst rot (einstellbar unter Grundlagen → Rechenannahmen).`,
      `Bivalenzpunkt: grün bis ${grad(sw.bivalenzGruen)}, gelb bis ${grad(sw.bivalenzGelb)}, sonst rot (einstellbar). ${BIVALENZ_HINWEIS}`,
      'Taktprüfung: Vorlauf je Außentemperatur aus der linearen Heizkurve. Grün, wenn die minimale Leistung bei +7 °C höchstens die Heizlast bei +7 °C beträgt, gelb bis +2 °C, sonst rot.',
      'Effizienz und Schall: Rangfolge der Geräte untereinander, daneben der echte Wert.',
      `Vorauswahl: ${VORAUSWAHL_HINWEIS} Grün bei 0,9 bis 1,3, gelb von 0,75 bis 0,9 und von 1,3 bis 1,6, sonst rot.`,
    ],
  });
  return bloecke;
}
