// Verbrauchsabgleich: Liste der Abgleiche und Editor mit Monatstabelle, Ergebnis und Annahmen.

import * as db from '../db.js';
import { el, ersetzeKinder, baueFormular } from '../ui.js';
import { ladeProjekt, rechne } from '../daten.js';
import { formatZahl, formatBereich, zahlZuText, parseDezimal } from '../engine/format.js';
import { berechneVerbrauch, vergleiche, annahmen, FREMDWAERME_HINWEIS } from '../engine/verbrauch.js';
import { mittlereInnentemperatur } from '../modell.js';
import { hatFehler, hatWarnungen, validiereVerbrauch } from '../validate.js';
import { verbrauchFelder, neuerVerbrauch, HEIZPERIODE_MONATE } from '../schemas.js';

const watt = (x) => `${formatZahl(x, 0)} W`;
const wattBereich = (b) => `${formatBereich(b.min, b.max, 0)} W`;
const mitVorzeichen = (x, stellen = 1) => `${x > 0 ? '+' : ''}${formatZahl(x, stellen)} %`.replace('-', '−');

const FEHLER_TEXT = {
  angaben_fehlen: 'Es fehlen Angaben.',
  holz_angaben_fehlen: 'Für das Holz fehlen Heizwert oder Wirkungsgrad.',
  warmwasser_zu_gross: 'Das Warmwasser ist größer als der Gasverbrauch.',
  monat_unvollstaendig: 'Ein gewählter Heizmonat ist unvollständig.',
  keine_heizmonate: 'Es ist kein Heizmonat gewählt.',
  gradtage_nicht_positiv: 'Die umgerechnete Gradtagzahl ist nicht positiv.',
};

// Berechnete Gebäudeheizlast als Bandbreite von der günstigen bis zur ungünstigen Rechnung.
function berechneteBandbreite(ergebnis) {
  if (!ergebnis || ergebnis.raeume.length === 0) return null;
  const g = ergebnis.gebaeude.guenstig.summe;
  const u = ergebnis.gebaeude.ungunstig.summe;
  return { min: Math.min(g, u), max: Math.max(g, u) };
}

function engineEingabe(doc, projekt) {
  return {
    gasKwh: doc.gasKwh,
    warmwasserKwh: doc.warmwasserKwh,
    kesselNutzungsgrad: doc.kesselNutzungsgrad,
    holzRm: doc.holzRm,
    heizwertRm: doc.heizwertRm,
    ofenWirkungsgrad: doc.ofenWirkungsgrad,
    monate: doc.monate ?? [],
    innentemperatur: doc.innentemperatur,
    normAussentemperatur: projekt.einstellungen.thetaAussen,
  };
}

// Ein Abgleich, ausgewertet: { meldungen, eingabe, ergebnis, vergleich } (ergebnis nur ohne Fehler).
function auswerten(doc, projekt, berechnet) {
  const meldungen = validiereVerbrauch(doc);
  const eingabe = engineEingabe(doc, projekt);
  if (hatFehler(meldungen)) return { meldungen, eingabe, ergebnis: null, vergleich: null };
  const ergebnis = berechneVerbrauch(eingabe);
  const vergleich = ergebnis.status === 'ok' ? vergleiche(berechnet, ergebnis.heizlast) : null;
  return { meldungen, eingabe, ergebnis, vergleich };
}

function abweichungsText(vergleich) {
  if (!vergleich || vergleich.abweichungProzent === null) return null;
  return `Abweichung ${mitVorzeichen(vergleich.abweichungProzent)} (Mittelwert Verbrauch gegenüber Berechnung)`;
}

// --- Ergebnis neben der berechneten Heizlast -----------------------------------------------

function ergebnisBloecke(doc, projekt, berechnet) {
  const { eingabe, ergebnis, vergleich } = auswerten(doc, projekt, berechnet);
  if (!ergebnis) {
    return [el(
      'section', { class: 'karte' },
      el('h3', {}, 'Ergebnis'),
      el('p', { class: 'zeile' }, 'Das Ergebnis erscheint, sobald alle Pflichtangaben stimmen: Gasverbrauch, Kesselnutzungsgrad, Innentemperatur und mindestens ein vollständiger Heizmonat.'),
    )];
  }
  if (ergebnis.status !== 'ok') {
    return [el('section', { class: 'karte' }, el('h3', {}, 'Ergebnis'), el('p', { class: 'meldung fehler' }, FEHLER_TEXT[ergebnis.grund] ?? 'Nicht berechenbar.'))];
  }

  const links = el(
    'div', { class: 'zahlenkarte' },
    el('p', { class: 'beschriftung' }, 'Berechnet aus den Räumen'),
    el('p', { class: 'gross' }, berechnet ? wattBereich(berechnet) : 'noch nicht berechenbar'),
    el('p', { class: 'zeile' }, berechnet ? `Gebäudeheizlast, Mittel ${watt(vergleich.mittelBerechnet)}` : 'Lege unter „Räume“ Räume mit Flächen an.'),
  );
  const rechts = el(
    'div', { class: 'zahlenkarte' },
    el('p', { class: 'beschriftung' }, 'Abgeleitet aus dem Verbrauch'),
    el('p', { class: 'gross' }, wattBereich(ergebnis.heizlast)),
    el('p', { class: 'zeile' }, `Mittel ${watt(ergebnis.heizlast.mittel)} · H = ${formatBereich(ergebnis.h.min, ergebnis.h.max, 1)} W/K`),
  );

  const abweichung = abweichungsText(vergleich);
  return [
    el(
      'section', { class: 'karte ergebnis' },
      el('h3', {}, `Heizlast bei Normaußentemperatur ${zahlZuText(eingabe.normAussentemperatur)} °C`),
      el('div', { class: 'gegenueber' }, links, rechts),
      abweichung
        ? el(
          'p', { class: 'abweichung' },
          el('strong', {}, abweichung),
          vergleich.ueberlappung ? ' · Die Bereiche überlappen.' : ' · Die Bereiche überlappen nicht.',
        )
        : null,
      el('p', { class: 'hinweisbox', role: 'note' }, el('strong', {}, 'Hinweis: '), FREMDWAERME_HINWEIS),
      el(
        'table', { class: 'tabelle' },
        el('tbody', {}, [
          ['Spezifischer Wärmeverlust H', `${formatBereich(ergebnis.h.min, ergebnis.h.max, 1)} W/K`],
          ['Nutzwärme Q', `${formatBereich(ergebnis.waerme.min, ergebnis.waerme.max, 0)} kWh`],
          ['Gradtagzahl G (umgerechnet)', `${formatZahl(ergebnis.gradtage.g, 0)} Kd`],
        ].map(([name, wert]) => el('tr', {}, el('th', { scope: 'row' }, name), el('td', { class: 'zahl' }, wert)))),
      ),
    ),
    el(
      'section', { class: 'karte' },
      el('h3', {}, 'Annahmen'),
      el('ol', { class: 'annahmen' }, annahmen(eingabe, ergebnis).filter((t) => t !== FREMDWAERME_HINWEIS).map((t) => el('li', {}, t))),
    ),
  ];
}

// --- Monatstabelle -----------------------------------------------------------------------

function baueMonate(startMonate, beiAenderung) {
  const zeilen = [];
  const tbody = el('tbody', {});
  const meldungen = el('div', { class: 'meldungen', 'aria-live': 'polite' });
  const anlegen = el('button', { type: 'button' }, 'Heizperiode anlegen (Oktober bis September)');

  const tabelle = el(
    'table', { class: 'tabelle monate' },
    el('thead', {}, el('tr', {}, ['Heizmonat', 'Monat', 'G20/15 (Kd)', 'Heiztage', ''].map((k) => el('th', {}, k)))),
    tbody,
  );

  const aktualisiereLeer = () => { anlegen.hidden = zeilen.length > 0; };

  function fuegeHinzu(m = {}) {
    const aenderung = () => beiAenderung();
    const eintrag = {
      id: m.id ?? db.neueId(),
      heiz: el('input', { type: 'checkbox', 'aria-label': 'Heizmonat', onChange: aenderung }),
      name: el('input', { type: 'text', value: m.name ?? '', 'aria-label': 'Monat', autocomplete: 'off', onInput: aenderung }),
      g: el('input', { type: 'text', inputmode: 'decimal', value: zahlZuText(m.gradtage), 'aria-label': 'Gradtagzahl G20/15', autocomplete: 'off', onInput: aenderung }),
      tage: el('input', { type: 'text', inputmode: 'decimal', value: zahlZuText(m.heiztage), 'aria-label': 'Heiztage', autocomplete: 'off', onInput: aenderung }),
    };
    eintrag.heiz.checked = Boolean(m.heizmonat);
    eintrag.zeile = el(
      'tr', { 'data-monat': eintrag.id },
      el('td', { 'data-label': 'Heizmonat', class: 'mitte' }, eintrag.heiz),
      el('td', { 'data-label': 'Monat' }, eintrag.name),
      el('td', { 'data-label': 'G20/15 (Kd)' }, eintrag.g),
      el('td', { 'data-label': 'Heiztage' }, eintrag.tage),
      el('td', { class: 'mitte' }, el('button', {
        type: 'button', class: 'klein gefahr', 'aria-label': 'Monat entfernen',
        onClick: () => {
          eintrag.zeile.remove();
          zeilen.splice(zeilen.indexOf(eintrag), 1);
          aktualisiereLeer();
          beiAenderung();
        },
      }, '✕')),
    );
    zeilen.push(eintrag);
    tbody.append(eintrag.zeile);
    aktualisiereLeer();
  }

  for (const m of startMonate) fuegeHinzu(m);
  aktualisiereLeer();
  anlegen.addEventListener('click', () => {
    for (const name of HEIZPERIODE_MONATE) fuegeHinzu({ name, heizmonat: false });
    beiAenderung();
  });

  return {
    element: el(
      'div', { class: 'feld' },
      el('span', { class: 'beschriftung' }, 'Gradtagzahlen je Monat'),
      el(
        'span', { class: 'hinweis' },
        'Gradtagzahl G20/15 und Heiztage je Monat aus einer Gradtagtabelle eintragen. Hake nur die Monate an, in denen geheizt wurde: '
        + 'Nur diese zählen in der Summe.',
      ),
      el('div', { class: 'tabellenrahmen schmal' }, tabelle),
      el(
        'div', { class: 'knopfzeile' },
        el('button', { type: 'button', onClick: () => { fuegeHinzu({}); beiAenderung(); } }, '+ Monat'),
        anlegen,
      ),
      meldungen,
    ),
    lies: () => zeilen.map((z) => ({
      id: z.id,
      name: z.name.value.trim(),
      gradtage: parseDezimal(z.g.value),
      heiztage: parseDezimal(z.tage.value),
      heizmonat: z.heiz.checked,
    })),
    zeigeMeldungen(liste) {
      meldungen.replaceChildren();
      for (const z of zeilen) z.zeile.classList.remove('hat-fehler', 'hat-warnung');
      for (const m of liste) {
        meldungen.append(el('p', { class: `meldung ${m.stufe}` }, `${m.stufe === 'fehler' ? '✕' : '⚠'} ${m.text}`));
        const z = zeilen.find((x) => x.id === m.monatId);
        if (z && !z.zeile.classList.contains('hat-fehler')) z.zeile.classList.add(m.stufe === 'fehler' ? 'hat-fehler' : 'hat-warnung');
      }
    },
  };
}

// --- Editor ------------------------------------------------------------------------------

export async function renderVerbrauch(container, id, neuLaden) {
  const [projekt, vorhandene] = await Promise.all([ladeProjekt(), db.alle('consumption')]);
  const gespeichert = id === 'neu' ? null : vorhandene.find((v) => v.id === id);
  if (id !== 'neu' && !gespeichert) {
    ersetzeKinder(
      container,
      el('p', { class: 'meldung fehler' }, 'Diesen Verbrauchsabgleich gibt es nicht mehr.'),
      el('a', { class: 'knopf', href: '#verbrauch' }, '← Alle Abgleiche'),
    );
    return;
  }

  const rohVorschlag = mittlereInnentemperatur(projekt.raeume);
  const vorschlag = rohVorschlag === null ? null : Math.round(rohVorschlag * 10) / 10;
  const doc = gespeichert ?? neuerVerbrauch(vorschlag);
  const berechnet = berechneteBandbreite(rechne(projekt).ergebnis);

  const ergebnisBereich = el('div', {});
  let formular;
  let monate;
  let bestaetigt = false;
  const speichernKnopf = el('button', { type: 'button', class: 'primaer' }, 'Speichern');
  const rueckmeldung = el('p', { class: 'ok', 'aria-live': 'polite' });

  const lesen = () => ({ ...doc, ...formular.lies(), monate: monate.lies() });
  const aktualisiere = () => {
    bestaetigt = false;
    speichernKnopf.textContent = 'Speichern';
    rueckmeldung.textContent = '';
    ersetzeKinder(ergebnisBereich, ...ergebnisBloecke(lesen(), projekt, berechnet));
  };

  formular = baueFormular(verbrauchFelder({ vorschlag }), doc, aktualisiere);
  monate = baueMonate(doc.monate ?? [], aktualisiere);

  speichernKnopf.addEventListener('click', async () => {
    const gelesen = lesen();
    const meldungen = validiereVerbrauch(gelesen);
    formular.zeigeMeldungen(meldungen.filter((m) => m.feld !== 'monate'));
    monate.zeigeMeldungen(meldungen.filter((m) => m.feld === 'monate'));
    if (hatFehler(meldungen)) return;
    if (hatWarnungen(meldungen) && !bestaetigt) {
      bestaetigt = true;
      speichernKnopf.textContent = 'Trotzdem speichern';
      return;
    }
    const neueId = gelesen.id ?? db.neueId();
    await db.speichere('consumption', { ...gelesen, id: neueId });
    bestaetigt = false;
    speichernKnopf.textContent = 'Speichern';
    if (id === 'neu') {
      location.hash = `#verbrauch/${neueId}`;
    } else {
      rueckmeldung.textContent = 'Gespeichert.';
    }
  });

  const vorschlagKnopf = vorschlag === null
    ? null
    : el('button', {
      type: 'button',
      onClick: () => formular.setzeFeld('innentemperatur', vorschlag),
    }, `Innentemperatur auf Vorschlag setzen (${zahlZuText(vorschlag)} °C)`);

  ersetzeKinder(
    container,
    el('a', { class: 'knopf', href: '#verbrauch' }, '← Alle Abgleiche'),
    el('div', { class: 'kopf abstand' }, el('h2', {}, gespeichert ? gespeichert.name : 'Neuer Verbrauchsabgleich')),
    el(
      'p', { class: 'beschreibung' },
      'Plausibilitätsprüfung: Aus dem Verbrauch von Gas und Holz wird die Heizlast bei Normaußentemperatur abgeleitet und neben die berechnete Gebäudeheizlast gestellt.',
    ),
    el(
      'div', { class: 'verbrauch-layout' },
      el(
        'div', { class: 'links' },
        formular.element,
        el('div', { class: 'formular abstand' }, monate.element),
        el('div', { class: 'knopfzeile' }, vorschlagKnopf, speichernKnopf, rueckmeldung),
      ),
      el('div', { class: 'rechts' }, ergebnisBereich),
    ),
  );
  aktualisiere();
}

// --- Liste -------------------------------------------------------------------------------

export async function renderVerbrauchListe(container, neuLaden) {
  const [projekt, alle] = await Promise.all([ladeProjekt(), db.alle('consumption')]);
  const berechnet = berechneteBandbreite(rechne(projekt).ergebnis);
  alle.sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const karten = alle.map((doc) => {
    const { ergebnis, vergleich } = auswerten(doc, projekt, berechnet);
    const ok = ergebnis?.status === 'ok';
    const aktive = (doc.monate ?? []).filter((m) => m.heizmonat).length;
    return el(
      'article', { class: ok ? 'karte' : 'karte markiert' },
      el('h3', {}, doc.name, ok ? null : el('span', { class: 'marke' }, '⚠ unvollständig')),
      el('p', { class: 'zeile' }, [
        typeof doc.gasKwh === 'number' ? `Gas ${formatZahl(doc.gasKwh, 0)} kWh` : null,
        doc.holzRm > 0 ? `Holz ${zahlZuText(doc.holzRm)} Rm` : null,
        `${aktive} Heizmonat${aktive === 1 ? '' : 'e'}`,
      ].filter(Boolean).join(' · ')),
      ok
        ? el(
          'p', { class: 'zeile' },
          'Aus dem Verbrauch: ', el('strong', {}, wattBereich(ergebnis.heizlast)),
          berechnet ? [' · berechnet: ', el('strong', {}, wattBereich(berechnet))] : null,
          vergleich && vergleich.abweichungProzent !== null ? ` · Abweichung ${mitVorzeichen(vergleich.abweichungProzent)}` : null,
        )
        : el('p', { class: 'zeile' }, 'Noch kein Ergebnis, es fehlen Angaben.'),
      el(
        'div', { class: 'knopfzeile' },
        el('a', { class: 'knopf primaer', href: `#verbrauch/${doc.id}` }, 'Öffnen'),
        el('button', {
          type: 'button',
          onClick: async () => {
            await db.speichere('consumption', {
              ...doc, id: db.neueId(), name: `${doc.name} (Kopie)`, monate: (doc.monate ?? []).map((m) => ({ ...m, id: db.neueId() })),
            });
            neuLaden();
          },
        }, 'Kopieren'),
        el('button', {
          type: 'button', class: 'gefahr',
          onClick: async () => {
            if (!confirm(`Verbrauchsabgleich „${doc.name}“ löschen?`)) return;
            await db.loesche('consumption', doc.id);
            neuLaden();
          },
        }, 'Löschen'),
      ),
    );
  });

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Verbrauch'), el('a', { class: 'knopf primaer', href: '#verbrauch/neu' }, '+ Abgleich')),
    el(
      'p', { class: 'beschreibung' },
      'Plausibilitätsprüfung der berechneten Heizlast anhand des Gas- und Holzverbrauchs einer Heizperiode.',
    ),
    el('p', { class: 'hinweisbox', role: 'note' }, el('strong', {}, 'Hinweis: '), FREMDWAERME_HINWEIS),
    karten.length > 0
      ? el('div', { class: 'karten' }, karten)
      : el('p', { class: 'leer' }, 'Noch kein Abgleich. Mit „+ Abgleich“ legst du den ersten an.'),
  );
}
