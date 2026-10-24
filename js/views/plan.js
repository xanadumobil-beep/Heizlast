// Plan: schematische Darstellung der Raumbeziehungen mit verschiebbaren Kästen, Details zu Linien,
// markierten Auffälligkeiten und Vollständigkeitsprüfung.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { ladeProjekt, rechne } from '../daten.js';
import { baueplan, raumDetails, bezugDetails, symbolDetails, linienDetails, pruefZeilen, ZEICHEN } from '../plan.js';
import { geometrie, klemmePosition, FLAECHE_B } from '../planlayout.js';
import { zeichnePlan, legende } from '../planzeichnung.js';

// Räume und unbeheizte Zonen tragen ihre Position als plan: { x, y }. Zonenkästen haben die Id „zone:<Id>“.
function objektZuKasten(projekt, id) {
  if (id.startsWith('zone:')) return { store: 'zones', objekt: projekt.zonen.find((z) => z.id === id.slice(5)) };
  return { store: 'rooms', objekt: projekt.raeume.find((r) => r.id === id) };
}

const TIPP_TOLERANZ = 6; // Pixel, ab denen eine Berührung als Verschieben gilt

const KLASSE_ZEICHEN = { [ZEICHEN.ok]: 'pruef-ok', [ZEICHEN.warnung]: 'pruef-warnung', [ZEICHEN.fehler]: 'pruef-fehler' };

export function pruefTabelle(pruefung) {
  const zeilen = pruefZeilen(pruefung);
  return el(
    'div', { class: 'tabellenrahmen' },
    el(
      'table', { class: 'tabelle pruef-tabelle' },
      el('thead', {}, el('tr', {}, ['Raum', 'Prüfung', 'Ergebnis', 'Begründung'].map((k) => el('th', { scope: 'col' }, k)))),
      el('tbody', {}, zeilen.map(([raum, titel, zeichen, text]) => el(
        'tr', {},
        el('th', { scope: 'row' }, raum),
        el('td', {}, titel),
        el('td', { class: KLASSE_ZEICHEN[zeichen] ?? '' }, zeichen),
        el('td', {}, text),
      ))),
    ),
  );
}

export async function renderPlan(container) {
  const projekt = await ladeProjekt();
  if (projekt.raeume.length === 0) {
    ersetzeKinder(
      container,
      el('div', { class: 'kopf' }, el('h2', {}, 'Plan')),
      el('p', { class: 'leer' }, 'Es gibt noch keine Räume. Lege zuerst unter „Räume“ Räume an. Der Plan entsteht dann von selbst aus den Daten.'),
    );
    return;
  }
  const { ergebnis } = rechne(projekt);
  let anordnen = false;
  let auswahl = { raum: null, symbol: null, linie: null }; // linie: Id der Wand oder gebündelten Linie
  let bezuege = 'auswahl';
  let plan = null;
  let geom = null;

  const host = el('div', { class: 'plan-host' });
  const detail = el('section', { class: 'karte plan-detail', hidden: true, 'aria-live': 'polite' });

  function karte(d, knopf = null) {
    return [
      el('h3', {}, d.titel),
      d.kopf ? el('p', { class: 'zeile' }, d.kopf) : null,
      d.zeilen.map((z) => el('p', { class: 'zeile' }, z)),
      d.auffaelligkeiten?.length > 0 ? el('ul', { class: 'plan-auffaellig' }, d.auffaelligkeiten.map((t) => el('li', {}, `⚠ ${t}`))) : null,
      knopf,
    ].flat(2).filter(Boolean);
  }

  function zeigeDetail() {
    let inhalt = null;
    const linie = auswahl.linie ? geom.linien.find((l) => l.id === auswahl.linie) : null;
    if (linie) {
      if (linie.art === 'wand') {
        const einzel = plan.linien.find((l) => l.id === auswahl.linie);
        const d = linienDetails(einzel);
        inhalt = karte({ titel: d.titel, zeilen: d.zeilen });
      } else {
        inhalt = karte(bezugDetails(plan, linie.flaechenIds));
      }
    } else if (auswahl.raum?.startsWith('zone:')) {
      const d = symbolDetails(plan, auswahl.raum);
      if (d) {
        const bearbeiten = el('button', { type: 'button', onClick: () => { location.hash = '#zonen'; } }, 'Zonen bearbeiten');
        inhalt = karte(d, el('div', { class: 'knopfzeile' }, bearbeiten));
      }
    } else if (auswahl.raum) {
      const d = raumDetails(plan, auswahl.raum);
      if (d) {
        const oeffnen = el('button', { type: 'button', class: 'primaer', onClick: () => { location.hash = `#raum/${auswahl.raum}`; } }, 'Raumdetail öffnen');
        inhalt = karte(d, el('div', { class: 'knopfzeile' }, oeffnen));
      }
    } else if (auswahl.symbol) {
      const d = symbolDetails(plan, auswahl.symbol);
      if (d) inhalt = karte(d);
    }
    if (!inhalt) {
      detail.hidden = true;
      return;
    }
    ersetzeKinder(detail, inhalt);
    detail.hidden = false;
  }

  function zeichne() {
    plan = baueplan(projekt, ergebnis);
    geom = geometrie(plan, { auswahlRaum: auswahl.raum, auswahlSymbol: auswahl.symbol, bezuege });
    ersetzeKinder(host, zeichnePlan(geom, { interaktiv: true, ausgewaehlteLinie: auswahl.linie }));
    host.classList.toggle('plan-anordnen', anordnen);
    host.style.touchAction = anordnen ? 'none' : 'auto';
    zeigeDetail();
  }

  // Bildschirmposition in Einheiten der Zeichnung umrechnen.
  function inEinheiten(ereignis) {
    const svg = host.querySelector('svg');
    const abbildung = svg.getScreenCTM().inverse();
    const punkt = new DOMPoint(ereignis.clientX, ereignis.clientY).matrixTransform(abbildung);
    return { x: punkt.x, y: punkt.y };
  }

  let beruehrung = null;

  host.addEventListener('pointerdown', (e) => {
    const kastenKnoten = e.target.closest('[data-raum]');
    const linienKnoten = e.target.closest('[data-linie]');
    const symbolKnoten = e.target.closest('[data-symbol]');
    beruehrung = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, bewegt: false,
      raumId: kastenKnoten?.dataset.raum ?? null, linieId: linienKnoten?.dataset.linie ?? null,
      symbolId: symbolKnoten?.dataset.symbol ?? null, versatz: null,
    };
    if (anordnen && beruehrung.raumId) {
      const k = geom.kaesten.find((x) => x.id === beruehrung.raumId);
      const p = inEinheiten(e);
      beruehrung.versatz = { x: p.x - k.cx, y: p.y - k.cy };
      host.setPointerCapture(e.pointerId);
    }
  });

  let anfrage = 0;
  host.addEventListener('pointermove', (e) => {
    if (!beruehrung || e.pointerId !== beruehrung.id || !beruehrung.versatz) return;
    if (!beruehrung.bewegt && Math.hypot(e.clientX - beruehrung.startX, e.clientY - beruehrung.startY) < TIPP_TOLERANZ) return;
    beruehrung.bewegt = true;
    const k = geom.kaesten.find((x) => x.id === beruehrung.raumId);
    const boden = geom.boeden[k.boden];
    const p = inEinheiten(e);
    const neu = klemmePosition({
      x: ((p.x - beruehrung.versatz.x - boden.x) / FLAECHE_B) * 100,
      y: ((p.y - beruehrung.versatz.y - boden.y) / boden.h) * 100,
    });
    objektZuKasten(projekt, beruehrung.raumId).objekt.plan = neu;
    cancelAnimationFrame(anfrage);
    anfrage = requestAnimationFrame(zeichne);
  });

  host.addEventListener('pointerup', async (e) => {
    if (!beruehrung || e.pointerId !== beruehrung.id) return;
    const b = beruehrung;
    beruehrung = null;
    if (b.bewegt) {
      cancelAnimationFrame(anfrage);
      zeichne();
      const { store, objekt } = objektZuKasten(projekt, b.raumId);
      await db.speichere(store, objekt);
    } else if (b.raumId) {
      auswahl = auswahl.raum === b.raumId && !auswahl.linie ? { raum: null, symbol: null, linie: null } : { raum: b.raumId, symbol: null, linie: null };
      zeichne();
    } else if (b.symbolId) {
      auswahl = auswahl.symbol === b.symbolId ? { raum: null, symbol: null, linie: null } : { raum: null, symbol: b.symbolId, linie: null };
      zeichne();
    } else if (b.linieId) {
      auswahl = { ...auswahl, linie: auswahl.linie === b.linieId ? null : b.linieId };
      zeichne();
    } else if (auswahl.raum || auswahl.symbol || auswahl.linie) {
      auswahl = { raum: null, symbol: null, linie: null };
      zeichne();
    }
  });
  host.addEventListener('pointercancel', () => { beruehrung = null; });
  host.addEventListener('keydown', (e) => {
    const knoten = e.target.closest?.('[data-raum]');
    if (knoten && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      auswahl = { raum: knoten.dataset.raum, symbol: null, linie: null };
      zeichne();
    }
  });

  const anordnenKnopf = el('button', { type: 'button', 'aria-pressed': 'false' }, 'Kästen verschieben');
  anordnenKnopf.addEventListener('click', () => {
    anordnen = !anordnen;
    anordnenKnopf.setAttribute('aria-pressed', String(anordnen));
    anordnenKnopf.textContent = anordnen ? 'Verschieben ist an' : 'Kästen verschieben';
    zeichne();
  });

  const bezugKnopf = el('button', { type: 'button', 'aria-pressed': 'false' }, 'Linien: nur Auswahl');
  bezugKnopf.addEventListener('click', () => {
    bezuege = bezuege === 'alle' ? 'auswahl' : 'alle';
    bezugKnopf.setAttribute('aria-pressed', String(bezuege === 'alle'));
    bezugKnopf.textContent = bezuege === 'alle' ? 'Linien: alle' : 'Linien: nur Auswahl';
    zeichne();
  });

  const zuruecksetzen = el('button', { type: 'button', class: 'klein' }, 'Anordnung zurücksetzen');
  zuruecksetzen.addEventListener('click', async () => {
    if (!confirm('Alle Kästen wieder automatisch anordnen? Die gespeicherten Positionen werden verworfen.')) return;
    for (const [store, liste] of [['rooms', projekt.raeume], ['zones', projekt.zonen]]) {
      for (const eintrag of liste.filter((x) => x.plan)) {
        delete eintrag.plan;
        await db.speichere(store, eintrag);
      }
    }
    zeichne();
  });

  plan = baueplan(projekt, ergebnis);
  const auffaelligkeiten = plan.auffaelligkeiten.length === 0
    ? el('p', { class: 'ok' }, '✓ Keine Auffälligkeiten.')
    : el('ul', {}, plan.auffaelligkeiten.map((a) => el('li', {}, `„${projekt.raeume.find((r) => r.id === a.raumId)?.name ?? '?'}“: ${a.text}`)));

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Plan')),
    el(
      'p', { class: 'beschreibung' },
      'Schema der Räume, aus den Eingaben erzeugt. Zwischen den Räumen laufen die Wände (Pfeil: Richtung des angerechneten Verlusts). '
      + 'Die Marken im Kasten zeigen immer die Fläche an Außenluft, Nachbar, Zone und Erdreich. Die Linien zu Zonen und Randsymbolen '
      + 'erscheinen für den angetippten Raum oder Zonenkasten („Linien: nur Auswahl“) oder alle zugleich („Linien: alle“). '
      + 'Unter dem Plan stehen dann alle Flächen des gewählten Raums mit Verlust und der Knopf zum Raumdetail. '
      + 'Zum Umordnen „Kästen verschieben“ einschalten und die Kästen ziehen.',
    ),
    el('div', { class: 'plan-bedienung' }, anordnenKnopf, bezugKnopf, zuruecksetzen),
    host,
    detail,
    legende(),
    el('h3', {}, 'Auffälligkeiten'),
    auffaelligkeiten,
    el('h3', {}, 'Vollständigkeit je Raum'),
    pruefTabelle(plan.pruefung),
  );
  zeichne();
}
