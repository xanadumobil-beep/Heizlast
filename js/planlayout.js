// Geometrie des Plans: Koordinaten für Kästen, Symbole und Linien. Reine Funktionen ohne Oberfläche.
//
// Die Zeichnung hat eine feste Breite von 1000 Einheiten. Links liegen die Geschosse (je eine Zeichenfläche),
// rechts eine Spalte mit den Symbolen für Außenluft und Zonen. Positionen der Räume sind Prozentwerte der
// Zeichenfläche ihres Geschosses (Mittelpunkt des Kastens), siehe plan.js.

export const BREITE = 1000;
export const FLAECHE_B = 780;
export const FLAECHE_H = 520;
export const KASTEN_B = 176;
export const KASTEN_H = 104;
export const SYMBOL_X = 830;
export const SYMBOL_B = 160;
export const SYMBOL_H = 56;
const RAND_OBEN = 34;
const ABSTAND = 54;
const LINIENABSTAND = 11;

const grenze = (x, min, max) => Math.min(max, Math.max(min, x));
const runde = (x) => Math.round(x * 10) / 10;

// Zulässiger Bereich für den Mittelpunkt in Prozent, damit der Kasten ganz in der Zeichenfläche bleibt.
export function mittelpunktGrenzen() {
  return {
    xMin: (KASTEN_B / 2 / FLAECHE_B) * 100,
    xMax: 100 - (KASTEN_B / 2 / FLAECHE_B) * 100,
    yMin: (KASTEN_H / 2 / FLAECHE_H) * 100,
    yMax: 100 - (KASTEN_H / 2 / FLAECHE_H) * 100,
  };
}

export function klemmePosition({ x, y }) {
  const g = mittelpunktGrenzen();
  return { x: runde(grenze(x, g.xMin, g.xMax)), y: runde(grenze(y, g.yMin, g.yMax)) };
}

// Startanordnung: Das Raster verteilt sich über die ganze Zeichenfläche. Räume, die über eine Wand oder einen
// passiven Raum verbunden sind, kommen nebeneinander. Räume ohne gespeicherte Position nehmen der Reihe nach den
// ersten freien Platz, der keinen schon gesetzten Kasten überdeckt.
export function rasterPlaetze(anzahl) {
  const n = Math.max(anzahl, 1);
  const spalten = n <= 2 ? n : n <= 12 ? 3 : 4;
  const zeilen = Math.ceil(n / spalten);
  const plaetze = [];
  for (let i = 0; i < n; i += 1) {
    const spalte = i % spalten;
    const zeile = Math.floor(i / spalten);
    plaetze.push(klemmePosition({ x: ((spalte + 0.5) / spalten) * 100, y: ((zeile + 0.5) / zeilen) * 100 }));
  }
  return plaetze;
}

const ueberlappt = (a, b) => Math.abs(a.x - b.x) * (FLAECHE_B / 100) < KASTEN_B + 10 && Math.abs(a.y - b.y) * (FLAECHE_H / 100) < KASTEN_H + 10;

// Reihenfolge der Räume für die Startanordnung: mit dem am stärksten verbundenen Raum beginnen, dann jeweils den
// Raum mit den meisten Verbindungen zu den schon gesetzten. Gleichstand nach Name.
function ordneNachVerbindung(kaesten) {
  const ids = new Set(kaesten.map((k) => k.id));
  const verbindungen = (k) => (k.verbunden ?? []).filter((id) => ids.has(id));
  const offen = [...kaesten].sort((a, b) => verbindungen(b).length - verbindungen(a).length || a.name.localeCompare(b.name, 'de'));
  const reihe = [];
  while (offen.length > 0) {
    const gesetzt = new Set(reihe.map((k) => k.id));
    let beste = 0;
    if (reihe.length > 0) {
      const wert = (k) => verbindungen(k).filter((id) => gesetzt.has(id)).length;
      beste = offen.reduce((bi, k, i) => (wert(k) > wert(offen[bi]) ? i : bi), 0);
    }
    reihe.push(offen.splice(beste, 1)[0]);
  }
  return reihe;
}

// Position je Kasten eines Geschosses: gespeicherte, sonst automatische. Rückgabe: Map id → { x, y, gespeichert }
export function positionenFuerGeschoss(kaesten) {
  const ergebnis = new Map();
  const belegt = [];
  for (const k of kaesten.filter((x) => x.position)) {
    const p = klemmePosition(k.position);
    ergebnis.set(k.id, { ...p, gespeichert: true });
    belegt.push(p);
  }
  const plaetze = rasterPlaetze(kaesten.length);
  const einheiten = (p) => ({ x: (p.x / 100) * FLAECHE_B, y: (p.y / 100) * FLAECHE_H });
  for (const k of ordneNachVerbindung(kaesten.filter((x) => !x.position))) {
    const frei = plaetze.filter((p) => !belegt.some((b) => ueberlappt(p, b)));
    const kandidaten = frei.length > 0 ? frei : [plaetze[plaetze.length - 1]];
    // Der freie Platz mit der geringsten Entfernung zu den schon gesetzten verbundenen Räumen, sonst der erste.
    const partner = (k.verbunden ?? []).map((id) => ergebnis.get(id)).filter(Boolean).map(einheiten);
    const kosten = (p) => partner.reduce((summe, q) => summe + Math.hypot(einheiten(p).x - q.x, einheiten(p).y - q.y), 0);
    const platz = partner.length === 0 ? kandidaten[0] : kandidaten.reduce((beste, p) => (kosten(p) < kosten(beste) ? p : beste));
    ergebnis.set(k.id, { ...platz, gespeichert: false });
    belegt.push(platz);
  }
  return ergebnis;
}

// Schnittpunkt eines Strahls (von p in Richtung d) mit dem Rand eines Rechtecks um c, von innen betrachtet.
function randpunkt(p, d, ziel) {
  const c = { x: ziel.cx, y: ziel.cy };
  const w = ziel.b;
  const h = ziel.h;
  const grenzen = [];
  if (d.x !== 0) grenzen.push(((d.x > 0 ? c.x + w / 2 : c.x - w / 2) - p.x) / d.x);
  if (d.y !== 0) grenzen.push(((d.y > 0 ? c.y + h / 2 : c.y - h / 2) - p.y) / d.y);
  const t = Math.max(0, Math.min(...grenzen.filter((x) => x >= 0), 1));
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

function pfeilPunkte(mitte, richtung) {
  const laenge = Math.hypot(richtung.x, richtung.y) || 1;
  const d = { x: richtung.x / laenge, y: richtung.y / laenge };
  const n = { x: -d.y, y: d.x };
  const spitze = { x: mitte.x + d.x * 11, y: mitte.y + d.y * 11 };
  const a = { x: mitte.x - d.x * 9 + n.x * 9, y: mitte.y - d.y * 9 + n.y * 9 };
  const b = { x: mitte.x - d.x * 9 - n.x * 9, y: mitte.y - d.y * 9 - n.y * 9 };
  return [spitze, a, b].map((p) => `${runde(p.x)},${runde(p.y)}`).join(' ');
}

// Breite der Linie nach Fläche in m²: stärker bei größerer Fläche, begrenzt.
export function linienBreite(flaeche) {
  if (!(flaeche > 0)) return 2.5;
  return runde(Math.min(12, 1.5 + 1.3 * Math.sqrt(flaeche)));
}

// Reihenfolge der Marken im Kasten.
const MARKEN_REIHENFOLGE = ['aussen', 'nachbar', 'unbeheizt', 'erdreich'];

// Koordinaten für den Plan. plan: Ergebnis von baueplan().
// optionen: { auswahlRaum, auswahlSymbol, bezuege: 'marken' | 'alle' }
//   Wände zwischen Räumen und Linien passiver Räume stehen immer im Plan. Die Bezüge zu Außenluft und Zonen sind
//   als Marken im Kasten zusammengefasst. Als Linie (je Raum und Gegenseite eine, Fläche summiert) erscheinen sie nur
//   für den gewählten Raum, das gewählte Symbol oder bei bezuege 'alle'.
// Rückgabe: { breite, hoehe, boeden, kaesten, symbole, linien, passivLinien }
export function geometrie(plan, optionen = {}) {
  const { auswahlRaum = null, auswahlSymbol = null, bezuege = 'marken' } = optionen;
  const boeden = plan.geschosse.map((g, i) => ({ name: g.name, x: 0, y: RAND_OBEN + i * (FLAECHE_H + ABSTAND), b: FLAECHE_B, h: FLAECHE_H }));
  const hoehe = Math.max(RAND_OBEN + boeden.length * (FLAECHE_H + ABSTAND) - ABSTAND + 10, SYMBOL_H * plan.symbole.length + 20);

  // Marken: je Raum die Flächen nach Art der Gegenseite zusammengezählt.
  const marken = new Map();
  for (const l of plan.linien.filter((x) => x.zielArt !== 'raum')) {
    if (!marken.has(l.raumId)) marken.set(l.raumId, new Map());
    const je = marken.get(l.raumId);
    const eintrag = je.get(l.farbe) ?? { farbe: l.farbe, flaeche: 0, markiert: false };
    eintrag.flaeche += l.flaeche ?? 0;
    eintrag.markiert = eintrag.markiert || l.marker.length > 0;
    je.set(l.farbe, eintrag);
  }

  const kaesten = [];
  plan.geschosse.forEach((g, i) => {
    const boden = boeden[i];
    const positionen = positionenFuerGeschoss(g.kaesten);
    for (const k of g.kaesten) {
      const pos = positionen.get(k.id);
      const cx = boden.x + (pos.x / 100) * boden.b;
      const cy = boden.y + (pos.y / 100) * boden.h;
      const chips = MARKEN_REIHENFOLGE.map((f) => marken.get(k.id)?.get(f)).filter(Boolean);
      kaesten.push({
        ...k, cx, cy, x: cx - KASTEN_B / 2, y: cy - KASTEN_H / 2, b: KASTEN_B, h: KASTEN_H, boden: i,
        prozent: { x: pos.x, y: pos.y }, gespeichert: pos.gespeichert, marken: chips, gewaehlt: k.id === auswahlRaum,
      });
    }
  });

  const schritt = (hoehe - 20) / plan.symbole.length;
  const symbole = plan.symbole.map((s, i) => {
    const y = 10 + i * schritt + (schritt - SYMBOL_H) / 2;
    return { ...s, x: SYMBOL_X, y, b: SYMBOL_B, h: SYMBOL_H, cx: SYMBOL_X + SYMBOL_B / 2, cy: y + SYMBOL_H / 2, gewaehlt: s.id === auswahlSymbol };
  });

  const ziele = new Map([...kaesten, ...symbole].map((t) => [t.id, t]));

  // Zu zeichnende Einträge: Wände einzeln, Außenbezüge gebündelt (und nur bei Bedarf).
  const eintraege = [];
  const buendel = new Map();
  for (const l of plan.linien) {
    if (l.zielArt === 'raum') {
      eintraege.push({ art: 'wand', id: l.id, raumId: l.raumId, zielId: l.zielId, farbe: l.farbe, flaeche: l.netto ?? l.flaeche, flaechenIds: [l.id], markiert: l.marker.length > 0, pfeil: l.pfeil });
      continue;
    }
    const sichtbar = bezuege === 'alle' || l.raumId === auswahlRaum || l.zielId === auswahlSymbol;
    if (!sichtbar) continue;
    const schluessel = `${l.raumId}|${l.zielId}`;
    if (!buendel.has(schluessel)) {
      buendel.set(schluessel, { art: 'bezug', id: `b-${schluessel}`, raumId: l.raumId, zielId: l.zielId, farbe: l.farbe, flaeche: 0, flaechenIds: [], markiert: false, pfeil: null });
      eintraege.push(buendel.get(schluessel));
    }
    const b = buendel.get(schluessel);
    b.flaeche += l.netto ?? l.flaeche ?? 0;
    b.flaechenIds.push(l.id);
    b.markiert = b.markiert || l.marker.length > 0;
  }

  // Wände zwischen demselben Raumpaar werden parallel versetzt, damit sie nicht übereinanderliegen.
  const gruppen = new Map();
  for (const e of eintraege) {
    const schluessel = [e.raumId, e.zielId].sort().join('|');
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
    gruppen.get(schluessel).push(e);
  }

  const linien = [];
  for (const gruppe of gruppen.values()) {
    gruppe.forEach((l, index) => {
      const von = ziele.get(l.raumId);
      const nach = ziele.get(l.zielId);
      if (!von || !nach) return;
      const d = { x: nach.cx - von.cx, y: nach.cy - von.cy };
      const laenge = Math.hypot(d.x, d.y) || 1;
      const normale = { x: -d.y / laenge, y: d.x / laenge };
      // Die Versatzrichtung hängt von der Reihenfolge der Ids ab, damit beide Richtungen gleich liegen.
      const vorzeichen = l.raumId < l.zielId ? 1 : -1;
      const versatz = (index - (gruppe.length - 1) / 2) * LINIENABSTAND * vorzeichen;
      const p1 = { x: von.cx + normale.x * versatz, y: von.cy + normale.y * versatz };
      const p2 = { x: nach.cx + normale.x * versatz, y: nach.cy + normale.y * versatz };
      const r = { x: p2.x - p1.x, y: p2.y - p1.y };
      const start = randpunkt(p1, r, von);
      const ende = randpunkt(p2, { x: -r.x, y: -r.y }, nach);
      const mitte = { x: (start.x + ende.x) / 2, y: (start.y + ende.y) / 2 };
      let pfeil = null;
      if (l.pfeil) {
        const richtung = l.pfeil.von === l.raumId ? { x: ende.x - start.x, y: ende.y - start.y } : { x: start.x - ende.x, y: start.y - ende.y };
        pfeil = pfeilPunkte(mitte, richtung);
      }
      linien.push({
        id: l.id, art: l.art, raumId: l.raumId, zielId: l.zielId, farbe: l.farbe, flaechenIds: l.flaechenIds, breite: linienBreite(l.flaeche),
        x1: runde(start.x), y1: runde(start.y), x2: runde(ende.x), y2: runde(ende.y), mitte: { x: runde(mitte.x), y: runde(mitte.y) },
        pfeil, markiert: l.markiert,
      });
    });
  }

  const passivLinien = plan.passivLinien.flatMap((p) => {
    const von = ziele.get(p.von);
    const nach = ziele.get(p.zu);
    if (!von || !nach) return [];
    const d = { x: nach.cx - von.cx, y: nach.cy - von.cy };
    const laenge = Math.hypot(d.x, d.y) || 1;
    // Seitlich versetzt, damit die gestrichelte Linie nicht auf einer Wandlinie desselben Paars liegt.
    const versatz = { x: (-d.y / laenge) * 18, y: (d.x / laenge) * 18 };
    const p1 = { x: von.cx + versatz.x, y: von.cy + versatz.y };
    const p2 = { x: nach.cx + versatz.x, y: nach.cy + versatz.y };
    const start = randpunkt(p1, d, von);
    const ende = randpunkt(p2, { x: -d.x, y: -d.y }, nach);
    return [{
      id: p.id, von: p.von, zu: p.zu, prozent: p.prozent,
      x1: runde(start.x), y1: runde(start.y), x2: runde(ende.x), y2: runde(ende.y),
      mitte: { x: runde((start.x + ende.x) / 2), y: runde((start.y + ende.y) / 2) },
    }];
  });

  return { breite: BREITE, hoehe: Math.round(hoehe), boeden, kaesten, symbole, linien, passivLinien };
}
