// Fotos je Raum: Galerie im Raumdetail und Vollbildansicht mit Zoom und Markierungen.
// Die Bilder liegen als Blob in IndexedDB. Markierungen sind in Prozent des Bildes gespeichert und verknüpfen
// eine Öffnung, einen Heizkörper oder eine Raumfläche dieses Raums (oder bleiben frei beschriftet).

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { ladeIstProjekt } from '../daten.js';
import { verkleinereBild, BildFehler } from '../bild.js';
import {
  sortiereFotos, fotoTitelVorgabe, bytesText, neueMarkierung, markierungsText, beschriftungFuerZiel, verknuepfungsZiele,
  markierungenFuerZiel, begrenzeProzent,
} from '../foto.js';

// Adressen der angezeigten Bilder. Beim nächsten Aufbau einer Foto-Ansicht werden die alten freigegeben.
let adressen = [];
function neueAdresse(blob) {
  const a = URL.createObjectURL(blob);
  adressen.push(a);
  return a;
}
function gibAdressenFrei() {
  for (const a of adressen) URL.revokeObjectURL(a);
  adressen = [];
}

const datumFeld = (iso) => (iso ? String(iso).slice(0, 10) : '');
const datumAnzeige = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

// Zeile „Auf Fotos markiert“ für Heizkörper, Öffnung oder Fläche: Links springen zum Foto und zur Markierung.
export function fotoMarkenZeile(projekt, art, id) {
  const treffer = markierungenFuerZiel(projekt.markierungen ?? [], projekt.fotoInfos ?? [], art, id);
  if (treffer.length === 0) return null;
  return el(
    'p', { class: 'zeile fotomarken' },
    'Auf Foto markiert: ',
    treffer.map(({ markierung, foto }, i) => [
      i > 0 ? ', ' : null,
      el('a', { href: `#foto/${foto.id}/${markierung.id}` }, `${foto.titel || 'Foto'}`),
    ]),
  );
}

// --- Galerie im Raumdetail -----------------------------------------------------------------------

async function fuegeFotosHinzu(dateien, raum, meldung, neuLaden) {
  const vorhanden = (await db.alle('photos')).filter((f) => f.raumId === raum.id).length;
  let erfolge = 0;
  const fehler = [];
  for (let i = 0; i < dateien.length; i += 1) {
    const datei = dateien[i];
    meldung.textContent = `Foto ${i + 1} von ${dateien.length} wird verkleinert und gespeichert …`;
    try {
      const { blob, breite, hoehe, vorschau } = await verkleinereBild(datei);
      await db.speichere('photos', {
        id: db.neueId(),
        raumId: raum.id,
        titel: fotoTitelVorgabe(vorhanden + erfolge),
        notiz: '',
        datum: datei.lastModified ? new Date(datei.lastModified).toISOString() : new Date().toISOString(),
        breite,
        hoehe,
        blob,
        vorschau,
        groesse: blob.size + vorschau.size,
      });
      erfolge += 1;
    } catch (ausnahme) {
      fehler.push(`${datei.name || 'Foto'}: ${ausnahme instanceof BildFehler ? ausnahme.message : ausnahme.name === 'QuotaExceededError' ? 'Der Speicher des Geräts ist voll.' : ausnahme.message}`);
      if (ausnahme.name === 'QuotaExceededError') break;
    }
  }
  meldung.className = fehler.length > 0 ? 'meldung fehler' : 'ok';
  meldung.textContent = `${erfolge} Foto${erfolge === 1 ? '' : 's'} gespeichert.${fehler.length > 0 ? ` ${fehler.join(' ')}` : ''}`;
  if (erfolge > 0) neuLaden();
}

export async function fotoAbschnitt(projekt, raum, neuLaden) {
  gibAdressenFrei();
  const fotos = sortiereFotos((await db.alle('photos')).filter((f) => f.raumId === raum.id));
  const meldung = el('p', { class: 'zeile', 'aria-live': 'polite' });

  const wahl = (beschriftung, eigenschaften) => {
    const eingabe = el('input', { type: 'file', accept: 'image/*', class: 'versteckt', 'aria-label': beschriftung, ...eigenschaften });
    eingabe.addEventListener('change', async () => {
      const dateien = [...eingabe.files];
      eingabe.value = '';
      if (dateien.length > 0) await fuegeFotosHinzu(dateien, raum, meldung, neuLaden);
    });
    return el('label', { class: 'knopf' }, beschriftung, eingabe);
  };

  return el(
    'section', { class: 'abstand fotoabschnitt' },
    el(
      'div', { class: 'kopf' },
      el('h3', {}, `Fotos (${fotos.length})`),
      el('div', { class: 'knopfzeile' }, wahl('Foto aufnehmen', { capture: 'environment' }), wahl('Aus Mediathek wählen', { multiple: true })),
    ),
    meldung,
    fotos.length > 0
      ? el('ul', { class: 'fotogalerie' }, fotos.map((f) => {
        const anzahl = (projekt.markierungen ?? []).filter((m) => m.fotoId === f.id).length;
        return el(
          'li', {},
          el(
            'a', { href: `#foto/${f.id}`, 'aria-label': `Foto ${f.titel} öffnen` },
            el('img', { src: neueAdresse(f.vorschau ?? f.blob), alt: f.titel || 'Foto', loading: 'lazy' }),
            el('span', { class: 'fotoname' }, f.titel || 'Foto'),
            el('span', { class: 'klein' }, `${datumAnzeige(f.datum)}${anzahl > 0 ? ` · ${anzahl} Markierung${anzahl === 1 ? '' : 'en'}` : ''}`),
          ),
        );
      }))
      : el('p', { class: 'leer' }, 'Noch keine Fotos. Mit „Foto aufnehmen“ oder „Aus Mediathek wählen“ (mehrere auf einmal möglich) kommen Fotos in diesen Raum. Sie werden auf höchstens 2048 Pixel verkleinert.'),
    fotos.length > 0 ? el('p', { class: 'klein' }, `Speicher dieser Fotos: ${bytesText(fotos.reduce((s, f) => s + (f.groesse ?? f.blob.size), 0))}`) : null,
  );
}

// --- Vollbild mit Zoom und Markierungen --------------------------------------------------------

const MAX_ZOOM = 8;
const TIPP_WEG = 8; // Pixel
const TIPP_ZEIT = 450; // Millisekunden
const DOPPELTIPP_ZEIT = 320;

export async function renderFoto(container, fotoId, markerId) {
  gibAdressenFrei();
  const [foto, projekt] = await Promise.all([db.lade('photos', fotoId), ladeIstProjekt()]);
  if (!foto) {
    ersetzeKinder(container, el('p', { class: 'meldung fehler' }, 'Dieses Foto gibt es nicht mehr.'), el('a', { class: 'knopf', href: '#raeume' }, '← Alle Räume'));
    return;
  }
  const raum = projekt.raeume.find((r) => r.id === foto.raumId);
  const nurLesen = db.istSchreibgeschuetzt();
  let marker = (await db.alle('markers')).filter((m) => m.fotoId === foto.id);
  let gewaehlt = markerId && marker.some((m) => m.id === markerId) ? markerId : null;
  let markieren = false;

  const ansicht = { s: 1, tx: 0, ty: 0, basisB: 0, basisH: 0, bereit: false };
  const bild = el('img', { src: neueAdresse(foto.blob), alt: foto.titel || 'Foto', draggable: 'false', class: 'foto-bild' });
  const ebene = el('div', { class: 'foto-markierungen' });
  const welt = el('div', { class: 'foto-welt' }, bild, ebene);
  const flaeche = el('div', { class: 'foto-flaeche', role: 'img', 'aria-label': `Foto ${foto.titel || ''}` }, welt);
  const panel = el('div', { class: 'foto-panel' });
  const hinweis = el('p', { class: 'foto-hinweis', 'aria-live': 'polite' });
  const markierenKnopf = el('button', { type: 'button', 'aria-pressed': 'false', disabled: nurLesen }, 'Markieren');

  // --- Anzeige und Zoom ---
  function begrenze() {
    const cw = flaeche.clientWidth;
    const ch = flaeche.clientHeight;
    const w = ansicht.basisB * ansicht.s;
    const h = ansicht.basisH * ansicht.s;
    ansicht.tx = w <= cw ? (cw - w) / 2 : Math.min(0, Math.max(cw - w, ansicht.tx));
    ansicht.ty = h <= ch ? (ch - h) / 2 : Math.min(0, Math.max(ch - h, ansicht.ty));
  }
  function wende() {
    begrenze();
    welt.style.transform = `translate(${ansicht.tx}px, ${ansicht.ty}px) scale(${ansicht.s})`;
    welt.style.setProperty('--inv', String(1 / ansicht.s));
  }
  function layout() {
    const cw = flaeche.clientWidth;
    const ch = flaeche.clientHeight;
    if (!(cw > 0 && ch > 0)) return;
    const fit = Math.min(cw / foto.breite, ch / foto.hoehe);
    ansicht.basisB = foto.breite * fit;
    ansicht.basisH = foto.hoehe * fit;
    welt.style.width = `${ansicht.basisB}px`;
    welt.style.height = `${ansicht.basisH}px`;
    if (!ansicht.bereit) {
      ansicht.bereit = true;
      ansicht.s = 1;
    }
    wende();
  }
  function zoomUm(px, py, faktor) {
    const neu = Math.min(MAX_ZOOM, Math.max(1, ansicht.s * faktor));
    ansicht.tx = px - ((px - ansicht.tx) * neu) / ansicht.s;
    ansicht.ty = py - ((py - ansicht.ty) * neu) / ansicht.s;
    ansicht.s = neu;
    wende();
  }
  const mitteDerFlaeche = () => [flaeche.clientWidth / 2, flaeche.clientHeight / 2];
  const lokal = (e) => { const r = flaeche.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // Position in Prozent des Bildes (die Transformation ist in getBoundingClientRect enthalten).
  function prozentAus(e) {
    const r = bild.getBoundingClientRect();
    return [begrenzeProzent(((e.clientX - r.left) / r.width) * 100), begrenzeProzent(((e.clientY - r.top) / r.height) * 100)];
  }

  // --- Markierungen ---
  const speichereMarker = (m) => db.speichere('markers', m);
  const zeigeMarkierungen = () => {
    ersetzeKinder(ebene, marker.map((m, i) => {
      const t = markierungsText(projekt, m);
      return el(
        'div', {
          class: `marke-punkt${m.id === gewaehlt ? ' gewaehlt' : ''}${t.fehlt ? ' fehlt' : ''}`,
          style: `left: ${m.x}%; top: ${m.y}%`, 'data-marker': m.id,
        },
        el('span', { class: 'marke-pin' }, t.fehlt ? '!' : String(i + 1)),
        el('span', { class: 'marke-text' }, t.text),
      );
    }));
  };

  function zeigePanel() {
    const m = marker.find((x) => x.id === gewaehlt);
    ersetzeKinder(panel, fotoDetails(), m ? markerEditor(m) : markerListe());
  }

  function fotoDetails() {
    const titel = el('input', { type: 'text', value: foto.titel ?? '', 'aria-label': 'Titel', disabled: nurLesen });
    const datum = el('input', { type: 'date', value: datumFeld(foto.datum), 'aria-label': 'Datum', disabled: nurLesen });
    const notiz = el('textarea', { rows: 3, 'aria-label': 'Notiz', disabled: nurLesen });
    notiz.value = foto.notiz ?? '';
    const rueck = el('span', { class: 'ok', 'aria-live': 'polite' });
    return el(
      'details', { class: 'foto-details', open: marker.length === 0 || undefined },
      el('summary', {}, `${foto.titel || 'Foto'} · ${datumAnzeige(foto.datum)} · ${raum?.name ?? ''}`),
      el('label', {}, el('span', { class: 'klein' }, 'Titel'), titel),
      el('label', {}, el('span', { class: 'klein' }, 'Datum'), datum),
      el('label', {}, el('span', { class: 'klein' }, 'Notiz (mit dem Mikrofon der Tastatur diktieren)'), notiz),
      el('p', { class: 'klein' }, `${foto.breite} × ${foto.hoehe} px, ${bytesText(foto.groesse ?? foto.blob.size)}`),
      el(
        'div', { class: 'knopfzeile' },
        el('button', {
          type: 'button', class: 'primaer', disabled: nurLesen,
          onClick: async () => {
            foto.titel = titel.value.trim();
            foto.notiz = notiz.value;
            if (datum.value) foto.datum = new Date(`${datum.value}T12:00:00`).toISOString();
            await db.speichere('photos', foto);
            rueck.textContent = 'Gespeichert.';
            leiste.querySelector('.foto-titel').textContent = foto.titel || 'Foto';
          },
        }, 'Speichern'),
        el('button', {
          type: 'button', class: 'gefahr', disabled: nurLesen,
          onClick: async () => {
            if (!confirm(`Foto „${foto.titel || 'Foto'}“ mit ${marker.length} Markierung${marker.length === 1 ? '' : 'en'} löschen?`)) return;
            for (const m of marker) await db.loesche('markers', m.id);
            await db.loesche('photos', foto.id);
            location.hash = raum ? `#raum/${raum.id}` : '#raeume';
          },
        }, 'Foto löschen'),
        rueck,
      ),
    );
  }

  function markerListe() {
    if (marker.length === 0) {
      return el('p', { class: 'zeile' }, nurLesen ? 'Keine Markierungen.' : 'Keine Markierungen. Schalte „Markieren“ ein und tippe auf das Foto, um eine Markierung zu setzen.');
    }
    return el(
      'ul', { class: 'markerliste' },
      marker.map((m, i) => {
        const t = markierungsText(projekt, m);
        return el('li', {}, el('button', { type: 'button', class: 'klein', onClick: () => waehle(m.id, true) }, `${i + 1}  ${t.text}${t.fehlt ? ' ⚠ Verknüpfung fehlt' : ''}`));
      }),
    );
  }

  function markerEditor(m) {
    const t = markierungsText(projekt, m);
    const ziele = raum ? verknuepfungsZiele(projekt, raum.id) : { oeffnung: [], heizkoerper: [], flaeche: [] };
    const gruppe = (titel2, art) => (ziele[art].length > 0
      ? el('optgroup', { label: titel2 }, ziele[art].map((z) => el('option', { value: `${art}:${z.id}` }, z.text)))
      : null);
    const fehltWert = m.ziel && t.fehlt ? `${m.ziel.art}:${m.ziel.id}` : null;
    const auswahl = el(
      'select', { 'aria-label': 'Verknüpfung', disabled: nurLesen },
      el('option', { value: '' }, 'Frei beschriftet (keine Verknüpfung)'),
      fehltWert ? el('option', { value: fehltWert }, `⚠ Verknüpfung fehlt: ${m.beschriftung}`) : null,
      gruppe('Öffnungen', 'oeffnung'), gruppe('Heizkörper', 'heizkoerper'), gruppe('Raumflächen', 'flaeche'),
    );
    auswahl.value = m.ziel ? `${m.ziel.art}:${m.ziel.id}` : '';
    const text = el('input', { type: 'text', value: t.text, 'aria-label': 'Beschriftung', disabled: nurLesen });
    auswahl.addEventListener('change', async () => {
      const [art, ...rest] = auswahl.value.split(':');
      m.ziel = auswahl.value === '' ? null : { art, id: rest.join(':') };
      if (m.ziel) {
        m.beschriftung = beschriftungFuerZiel(projekt, raum.id, m.ziel);
        m.auto = true;
      }
      await speichereMarker(m);
      zeigeMarkierungen();
      zeigePanel();
    });
    text.addEventListener('change', async () => {
      m.beschriftung = text.value.trim();
      m.auto = false;
      await speichereMarker(m);
      zeigeMarkierungen();
      zeigePanel();
    });
    return el(
      'section', { class: 'markereditor' },
      el('h4', {}, `Markierung ${marker.indexOf(m) + 1}`),
      t.fehlt ? el('p', { class: 'meldung warnung' }, 'Verknüpfung fehlt: Das verknüpfte Element wurde gelöscht. Die Markierung bleibt erhalten, du kannst sie neu verknüpfen oder frei beschriften.') : null,
      el('label', {}, el('span', { class: 'klein' }, 'Verknüpfung (Öffnung, Heizkörper oder Raumfläche dieses Raums)'), auswahl),
      el('label', {}, el('span', { class: 'klein' }, m.auto && m.ziel ? 'Beschriftung (folgt der Verknüpfung, änderbar)' : 'Beschriftung'), text),
      el(
        'div', { class: 'knopfzeile' },
        el('button', { type: 'button', onClick: () => waehle(null) }, 'Fertig'),
        el('button', {
          type: 'button', class: 'gefahr', disabled: nurLesen,
          onClick: async () => {
            if (!confirm('Diese Markierung löschen?')) return;
            await db.loesche('markers', m.id);
            marker = marker.filter((x) => x.id !== m.id);
            waehle(null);
          },
        }, 'Markierung löschen'),
      ),
    );
  }

  function waehle(id, hinzoomen = false) {
    gewaehlt = id;
    zeigeMarkierungen();
    zeigePanel();
    const m = marker.find((x) => x.id === id);
    if (m && hinzoomen && ansicht.bereit) {
      ansicht.s = Math.max(ansicht.s, 2.5);
      ansicht.tx = flaeche.clientWidth / 2 - (m.x / 100) * ansicht.basisB * ansicht.s;
      ansicht.ty = flaeche.clientHeight / 2 - (m.y / 100) * ansicht.basisH * ansicht.s;
      wende();
    }
  }

  // --- Gesten: Ziehen, Pinch, Doppeltipp, Mausrad; ein Tipp setzt oder wählt Markierungen ---
  const zeiger = new Map();
  let pinch = null;
  let ziehe = null; // Markierung, die gerade verschoben wird
  let letzterTipp = null;

  flaeche.addEventListener('pointerdown', (e) => {
    try { flaeche.setPointerCapture(e.pointerId); } catch { /* Zeiger schon beendet */ }
    const punkt = e.target.closest?.('[data-marker]');
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, zeit: Date.now(), markerId: punkt?.dataset.marker ?? null, weg: 0 });
    if (zeiger.size === 2) {
      const [a, b] = [...zeiger.values()];
      pinch = { abstand: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: ansicht.s };
      ziehe = null;
    } else if (zeiger.size === 1 && punkt && !nurLesen && punkt.dataset.marker === gewaehlt) {
      ziehe = marker.find((m) => m.id === punkt.dataset.marker);
    }
  });

  flaeche.addEventListener('pointermove', (e) => {
    const z = zeiger.get(e.pointerId);
    if (!z) return;
    const dx = e.clientX - z.x;
    const dy = e.clientY - z.y;
    z.weg = Math.max(z.weg, Math.hypot(e.clientX - z.startX, e.clientY - z.startY));
    z.x = e.clientX;
    z.y = e.clientY;
    if (zeiger.size === 2 && pinch) {
      const [a, b] = [...zeiger.values()];
      const abstand = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const r = flaeche.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      zoomUm(mx, my, (pinch.s * abstand) / pinch.abstand / ansicht.s);
      ansicht.tx += dx / 2;
      ansicht.ty += dy / 2;
      wende();
    } else if (ziehe && z.weg > TIPP_WEG) {
      const [px, py] = prozentAus(e);
      ziehe.x = px;
      ziehe.y = py;
      const knoten = ebene.querySelector(`[data-marker="${ziehe.id}"]`);
      if (knoten) { knoten.style.left = `${px}%`; knoten.style.top = `${py}%`; }
    } else if (zeiger.size === 1 && z.weg > TIPP_WEG) {
      ansicht.tx += dx;
      ansicht.ty += dy;
      wende();
    }
  });

  const beendeZeiger = async (e) => {
    const z = zeiger.get(e.pointerId);
    zeiger.delete(e.pointerId);
    if (zeiger.size < 2) pinch = null;
    if (!z) return;
    const war = ziehe;
    ziehe = null;
    if (war && z.weg > TIPP_WEG) {
      await speichereMarker(war);
      return;
    }
    const istTipp = z.weg <= TIPP_WEG && Date.now() - z.zeit < TIPP_ZEIT && zeiger.size === 0;
    if (!istTipp) return;
    if (z.markerId) { waehle(z.markerId); return; }
    // Doppeltipp: Zoom wechseln
    const jetzt = Date.now();
    if (letzterTipp && jetzt - letzterTipp.zeit < DOPPELTIPP_ZEIT && Math.hypot(e.clientX - letzterTipp.x, e.clientY - letzterTipp.y) < 30) {
      letzterTipp = null;
      const [lx, ly] = lokal(e);
      if (ansicht.s > 1.05) { ansicht.s = 1; wende(); } else zoomUm(lx, ly, 2.5);
      return;
    }
    letzterTipp = { zeit: jetzt, x: e.clientX, y: e.clientY };
    if (markieren && !nurLesen) {
      const [px, py] = prozentAus(e);
      if (px < 0 || px > 100 || py < 0 || py > 100) return;
      const m = neueMarkierung(db.neueId(), foto, px, py);
      marker.push(m);
      await speichereMarker(m);
      waehle(m.id);
    } else if (gewaehlt) {
      waehle(null);
    }
  };
  flaeche.addEventListener('pointerup', beendeZeiger);
  flaeche.addEventListener('pointercancel', (e) => { zeiger.delete(e.pointerId); pinch = null; ziehe = null; });
  flaeche.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [lx, ly] = lokal(e);
    zoomUm(lx, ly, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  markierenKnopf.addEventListener('click', () => {
    markieren = !markieren;
    markierenKnopf.setAttribute('aria-pressed', String(markieren));
    markierenKnopf.textContent = markieren ? 'Markieren ist an' : 'Markieren';
    hinweis.textContent = markieren ? 'Tippe auf das Foto, um eine Markierung zu setzen. Markierungen lassen sich nach dem Antippen verschieben.' : '';
    flaeche.classList.toggle('markiert-modus', markieren);
  });

  const leiste = el(
    'div', { class: 'foto-leiste' },
    el('a', { class: 'knopf', href: raum ? `#raum/${raum.id}` : '#raeume' }, `← ${raum?.name ?? 'Räume'}`),
    el('span', { class: 'foto-titel' }, foto.titel || 'Foto'),
    markierenKnopf,
    el('button', { type: 'button', 'aria-label': 'Verkleinern', onClick: () => zoomUm(...mitteDerFlaeche(), 1 / 1.5) }, '−'),
    el('button', { type: 'button', 'aria-label': 'Vergrößern', onClick: () => zoomUm(...mitteDerFlaeche(), 1.5) }, '+'),
    el('button', { type: 'button', onClick: () => { ansicht.s = 1; wende(); } }, 'Ganzes Bild'),
  );

  ersetzeKinder(container, el('div', { class: 'foto-voll' }, leiste, hinweis, flaeche, panel));
  zeigeMarkierungen();
  zeigePanel();
  if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(flaeche);
  requestAnimationFrame(() => { layout(); if (gewaehlt) waehle(gewaehlt, true); });
}
