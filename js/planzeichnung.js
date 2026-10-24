// Zeichnet den Plan als SVG. Bildschirm (mit Bedienung) und Bericht (statisch) nutzen dieselbe Zeichnung.
// Farben und Schriften stehen in css/style.css (Klassen pl-…), damit Hell, Dunkel und Druck passen.

import { el } from './ui.js';
import { formatZahl, zahlZuText } from './engine/format.js';
import { ZEICHEN } from './plan.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, eigenschaften = {}, ...kinder) {
  const knoten = document.createElementNS(NS, tag);
  for (const [name, wert] of Object.entries(eigenschaften)) {
    if (wert === undefined || wert === null || wert === false) continue;
    knoten.setAttribute(name, wert === true ? '' : wert);
  }
  for (const kind of kinder.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    knoten.append(kind.nodeType ? kind : document.createTextNode(String(kind)));
  }
  return knoten;
}

const kuerze = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const LINIENARTEN = [
  { farbe: 'aussen', text: 'Außenluft' },
  { farbe: 'erdreich', text: 'Erdreich' },
  { farbe: 'nachbar', text: 'Nachbar' },
  { farbe: 'unbeheizt', text: 'Unbeheizte Zone' },
  { farbe: 'raum', text: 'Raum zu Raum' },
];

// optionen: { interaktiv, ausgewaehlteLinie }
export function zeichnePlan(geom, optionen = {}) {
  const { interaktiv = false, ausgewaehlteLinie = null } = optionen;
  const svg = s('svg', {
    viewBox: `0 0 ${geom.breite} ${geom.hoehe}`, class: 'plan-svg', role: 'img',
    'aria-label': 'Plan der Raumbeziehungen', preserveAspectRatio: 'xMidYMin meet',
  });

  for (const b of geom.boeden) {
    svg.append(
      s('rect', { x: b.x, y: b.y, width: b.b, height: b.h, rx: 10, class: 'pl-boden', 'data-boden': b.name }),
      s('text', { x: b.x + 4, y: b.y - 10, class: 'pl-bodenname' }, b.name === 'Keller' ? 'Keller' : b.name),
    );
  }

  for (const p of geom.passivLinien) {
    svg.append(
      s('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, class: 'pl-passiv' }),
      s('rect', { x: p.mitte.x - 24, y: p.mitte.y - 11, width: 48, height: 22, rx: 6, class: 'pl-etikett' }),
      s('text', { x: p.mitte.x, y: p.mitte.y + 5, class: 'pl-prozent', 'text-anchor': 'middle' }, `${zahlZuText(p.prozent)} %`),
    );
  }

  for (const l of geom.linien) {
    const auswahl = l.id === ausgewaehlteLinie;
    const gruppe = s('g', { class: `pl-linie l-${l.farbe}${l.art === 'bezug' ? ' bezug' : ''}${l.markiert ? ' markiert' : ''}${auswahl ? ' gewaehlt' : ''}`, 'data-linie': l.id, 'data-flaechen': l.flaechenIds.join(',') });
    if (l.markiert || auswahl) {
      gruppe.append(s('line', { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, class: 'pl-halo', 'stroke-width': l.breite + 8 }));
    }
    gruppe.append(s('line', { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, class: 'pl-strich', 'stroke-width': l.breite, 'stroke-linecap': 'round' }));
    if (interaktiv) gruppe.append(s('line', { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, class: 'pl-treffer', 'stroke-width': Math.max(l.breite + 10, 24) }));
    if (l.pfeil) gruppe.append(s('polygon', { points: l.pfeil, class: 'pl-pfeil' }));
    if (l.markiert) {
      gruppe.append(
        s('circle', { cx: l.mitte.x, cy: l.mitte.y - (l.pfeil ? 20 : 0), r: 10, class: 'pl-warnkreis' }),
        s('text', { x: l.mitte.x, y: l.mitte.y - (l.pfeil ? 20 : 0) + 5, class: 'pl-warnzeichen', 'text-anchor': 'middle' }, '!'),
      );
    }
    svg.append(gruppe);
  }

  for (const sy of geom.symbole) {
    svg.append(s(
      'g', { class: `pl-symbol s-${sy.art}${sy.gewaehlt ? ' gewaehlt' : ''}`, 'data-symbol': sy.id },
      s('rect', { x: sy.x, y: sy.y, width: sy.b, height: sy.h, rx: sy.art === 'aussen' ? 28 : 10, class: 'pl-symbolflaeche' }),
      s('text', { x: sy.cx, y: sy.cy - 4, class: 'pl-symboltext', 'text-anchor': 'middle' }, kuerze(sy.name, 20)),
      s('text', { x: sy.cx, y: sy.cy + 15, class: 'pl-symbolnebentext', 'text-anchor': 'middle' }, sy.temperatur),
    ));
  }

  for (const k of geom.kaesten) {
    const gruppe = s(
      'g', { class: `pl-kasten ${k.status}${k.auffaellig ? ' auffaellig' : ''}${k.gewaehlt ? ' gewaehlt' : ''}`, 'data-raum': k.id, tabindex: interaktiv ? 0 : null },
      s('title', {}, `${k.name}: ${k.auffaelligkeiten.length > 0 ? k.auffaelligkeiten.join(' ') : 'keine Auffälligkeiten'}`),
      s('rect', { x: k.x, y: k.y, width: k.b, height: k.h, rx: 10, class: 'pl-kastenflaeche' }),
      s('text', { x: k.x + 10, y: k.y + 24, class: `pl-kastenname${k.name.length > 15 ? ' lang' : ''}` }, kuerze(k.name, k.name.length > 15 ? 20 : 18)),
      s('text', { x: k.x + 10, y: k.y + 45, class: 'pl-kastentext' }, k.istZone
        ? k.temperaturText
        : `${typeof k.theta === 'number' ? zahlZuText(k.theta) : '?'} °C · ${typeof k.flaeche === 'number' ? formatZahl(k.flaeche, 1) : '?'} m²`),
      s('text', { x: k.x + 10, y: k.y + 63, class: 'pl-kastenstatus' }, k.statusText),
    );
    if (k.symbol) {
      gruppe.append(s('text', { x: k.x + k.b - 10, y: k.y + 65, class: `pl-pruefzeichen z-${k.symbol}`, 'text-anchor': 'end' }, ZEICHEN[k.symbol]));
    }
    // Marken: Fläche in m² je Art der Gegenseite (Außenluft, Nachbar, unbeheizte Zone, Erdreich).
    k.marken.forEach((m, i) => {
      const x = k.x + 8 + i * 42;
      gruppe.append(
        s('rect', { x, y: k.y + k.h - 28, width: 38, height: 20, rx: 5, class: `pl-marke m-${m.farbe}${m.markiert ? ' markiert' : ''}` }),
        s('text', { x: x + 19, y: k.y + k.h - 13, class: 'pl-markentext', 'text-anchor': 'middle' }, m.flaeche > 0 ? formatZahl(m.flaeche, 0) : '?'),
      );
    });
    if (k.auffaellig) {
      gruppe.append(
        s('circle', { cx: k.x + k.b - 3, cy: k.y + 3, r: 11, class: 'pl-warnkreis' }),
        s('text', { x: k.x + k.b - 3, y: k.y + 8, class: 'pl-warnzeichen', 'text-anchor': 'middle' }, '!'),
      );
    }
    svg.append(gruppe);
  }
  return svg;
}

// Legende als HTML (Farben der Linien, Kästen und Zeichen).
export function legende() {
  const probe = (klasse, inhalt) => el('li', {}, el('span', { class: `legende-probe ${klasse}` }), inhalt);
  return el(
    'div', { class: 'plan-legende' },
    el('ul', {}, LINIENARTEN.map((a) => probe(`lp-linie l-${a.farbe}`, a.text)), probe('lp-passiv', 'Wärmelieferung passiver Raum (gestrichelt, mit Anteil)')),
    el('ul', {}, probe('lp-kasten beheizt', 'Beheizt'), probe('lp-kasten passiv', 'Passiv mitbeheizt'), probe('lp-kasten unbeheizt', 'Unbeheizt (nicht gerechnet)'), probe('lp-kasten zone', 'Unbeheizte Zone (Temperatur statt Fläche)')),
    el(
      'p', { class: 'klein' },
      'Farbige Marken im Kasten: Fläche in m² an Außenluft, Nachbar, unbeheizter Zone oder Erdreich (Farben wie die Linien). '
      + 'Linienstärke: je größer die Fläche, desto dicker. Pfeil: Richtung, in die der Wärmeverlust angerechnet wird (vom wärmeren zum kälteren Raum). '
      + 'Rot umrandet oder mit „!“: Auffälligkeit. ✓ ⚠ ✗ im Kasten: Vollständigkeitsprüfung.',
    ),
  );
}
