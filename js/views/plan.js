// Plan: schematische Darstellung der Raumbeziehungen mit verschiebbaren Kästen, Details zu Linien,
// markierten Auffälligkeiten und Vollständigkeitsprüfung.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { ladeProjekt, rechne } from '../daten.js';
import { baueplan, linienDetails, pruefZeilen, ZEICHEN } from '../plan.js';
import { geometrie, klemmePosition, FLAECHE_B } from '../planlayout.js';
import { zeichnePlan, legende } from '../planzeichnung.js';

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
  let gewaehlteLinie = null;
  let plan = null;
  let geom = null;

  const host = el('div', { class: 'plan-host' });
  const detail = el('section', { class: 'karte plan-detail', hidden: true, 'aria-live': 'polite' });

  function zeigeDetail() {
    const linie = plan.linien.find((l) => l.id === gewaehlteLinie);
    if (!linie) {
      detail.hidden = true;
      return;
    }
    const d = linienDetails(linie);
    ersetzeKinder(detail, el('h3', {}, d.titel), d.zeilen.map((z) => el('p', { class: 'zeile' }, z)));
    detail.hidden = false;
  }

  function zeichne() {
    plan = baueplan(projekt, ergebnis);
    geom = geometrie(plan);
    ersetzeKinder(host, zeichnePlan(geom, { interaktiv: true, ausgewaehlteLinie: gewaehlteLinie }));
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
    beruehrung = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, bewegt: false,
      raumId: kastenKnoten?.dataset.raum ?? null, linieId: linienKnoten?.dataset.linie ?? null, versatz: null,
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
    projekt.raeume.find((r) => r.id === beruehrung.raumId).plan = neu;
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
      const raum = projekt.raeume.find((r) => r.id === b.raumId);
      await db.speichere('rooms', raum);
    } else if (b.raumId) {
      location.hash = `#raum/${b.raumId}`;
    } else if (b.linieId) {
      gewaehlteLinie = gewaehlteLinie === b.linieId ? null : b.linieId;
      zeichne();
    } else if (gewaehlteLinie) {
      gewaehlteLinie = null;
      zeichne();
    }
  });
  host.addEventListener('pointercancel', () => { beruehrung = null; });
  host.addEventListener('keydown', (e) => {
    const knoten = e.target.closest?.('[data-raum]');
    if (knoten && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      location.hash = `#raum/${knoten.dataset.raum}`;
    }
  });

  const anordnenKnopf = el('button', { type: 'button', 'aria-pressed': 'false' }, 'Kästen verschieben');
  anordnenKnopf.addEventListener('click', () => {
    anordnen = !anordnen;
    anordnenKnopf.setAttribute('aria-pressed', String(anordnen));
    anordnenKnopf.textContent = anordnen ? 'Verschieben ist an' : 'Kästen verschieben';
    zeichne();
  });

  const zuruecksetzen = el('button', { type: 'button', class: 'klein' }, 'Anordnung zurücksetzen');
  zuruecksetzen.addEventListener('click', async () => {
    if (!confirm('Alle Kästen wieder automatisch anordnen? Die gespeicherten Positionen werden verworfen.')) return;
    for (const r of projekt.raeume.filter((x) => x.plan)) {
      delete r.plan;
      await db.speichere('rooms', r);
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
      'Schema der Räume und ihrer Nachbarn, aus den Eingaben erzeugt. Tippe auf einen Kasten, um den Raum zu öffnen, oder auf eine Linie '
      + 'für Bauteil, Fläche, U-Wert und Verlust. Zum Umordnen „Kästen verschieben“ einschalten und die Kästen mit dem Finger ziehen.',
    ),
    el('div', { class: 'plan-bedienung' }, anordnenKnopf, zuruecksetzen),
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
