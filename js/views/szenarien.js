// Szenarien: Liste mit Vergleich, Szenario-Editor mit Ist- und Szenario-Wert nebeneinander.
// Der Ist-Zustand wird hier nie geschrieben. Gespeichert werden nur Szenarien (Store "scenarios").

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { oeffneDialog } from '../dialog.js';
import { parseDezimal, zahlZuText } from '../engine/format.js';
import { ladeIstProjekt, ladeSzenarien, ladeAktivesSzenario, setzeAktivesSzenario } from '../daten.js';
import {
  neuesSzenario, kopiereSzenario, normalisiereSzenario, beschreibeAbweichungen, validiereSzenario, zaehleAbweichungen, wendeSzenarioAn,
} from '../szenario.js';
import { baueVergleich, vergleichTabellen } from '../vergleich.js';
import { hatFehler, hatWarnungen, validiereHeizkoerper } from '../validate.js';
import { parseKennlinie, kennlinieZuText, flaecheAusMassen } from '../modell.js';
import { flaechenBezeichnung } from '../anzeige.js';
import { formatZahl } from '../engine/format.js';
import {
  label, BAUARTEN_HK, HK_STATI, VENTILE, werte, neuerHeizkoerper, heizkoerperFelder, normWahlVon,
} from '../schemas.js';

const OPTIONEN = { bauarten: werte(BAUARTEN_HK), stati: werte(HK_STATI), ventile: werte(VENTILE) };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const bereichText = (b) => (b.min === b.max ? zahlZuText(b.min) : `${zahlZuText(b.min)} – ${zahlZuText(b.max)}`);

// --- Bausteine -------------------------------------------------------------------------------

function tabelle({ kopf, zeilen, ausrichtung = '', summenzeile = false }) {
  return el(
    'div', { class: 'tabellenrahmen' },
    el(
      'table', { class: 'tabelle vergleich-tabelle' },
      el('thead', {}, el('tr', {}, kopf.map((k) => el('th', { scope: 'col' }, k)))),
      el('tbody', {}, zeilen.map((zeile, r) => el(
        'tr', { class: summenzeile && r === zeilen.length - 1 ? 'summe' : '' },
        zeile.map((zelle, i) => el(i === 0 ? 'th' : 'td', { class: ausrichtung[i] === 'r' ? 'zahl' : '', scope: i === 0 ? 'row' : undefined }, zelle)),
      ))),
    ),
  );
}

// Zahlenfeld mit Komma. beiAenderung(wert): Zahl, null (leer) oder NaN (unlesbar).
function zahlFeld(wert, beiAenderung, beschriftung) {
  const eingabe = el('input', { type: 'text', inputmode: 'decimal', 'aria-label': beschriftung, value: zahlZuText(wert) });
  eingabe.addEventListener('input', () => beiAenderung(parseDezimal(eingabe.value)));
  return eingabe;
}

function auswahl(optionen, wert, beiAenderung, beschriftung) {
  const feld = el('select', { 'aria-label': beschriftung }, optionen.map((o) => el('option', { value: o.wert }, o.label)));
  feld.value = wert;
  feld.addEventListener('change', () => beiAenderung(feld.value));
  return feld;
}

const entfernenKnopf = (beiKlick, text = 'Entfernen') => el('button', { type: 'button', class: 'klein gefahr', onClick: beiKlick }, text);

// --- Liste und Vergleich -------------------------------------------------------------------------

function abweichungenListe(ist, szenario) {
  const zeilen = beschreibeAbweichungen(ist, szenario);
  if (zeilen.length === 0) return el('p', { class: 'zeile' }, 'Noch keine Abweichungen: Das Szenario entspricht dem Ist-Zustand.');
  return tabelle({
    kopf: ['Bereich', 'Ziel', 'Ist-Zustand', 'Szenario'],
    zeilen: zeilen.map((z) => [z.bereich, z.hinweis ? `${z.ziel} ⚠` : z.ziel, z.ist, z.szenario]),
  });
}

function szenarioKarte(ist, szenario, aktiv, neuLaden) {
  const anzahl = zaehleAbweichungen(szenario);
  const { hinweise } = wendeSzenarioAn(ist, szenario);
  const istAktiv = aktiv?.id === szenario.id;

  return el(
    'li', { class: `karte szenariokarte${istAktiv ? ' aktiv' : ''}` },
    el('h3', {}, szenario.name, istAktiv ? el('span', { class: 'marke' }, 'aktiv') : null),
    szenario.beschreibung ? el('p', { class: 'zeile' }, szenario.beschreibung) : null,
    el('p', { class: 'zeile' }, `${anzahl} Abweichung${anzahl === 1 ? '' : 'en'} gegenüber dem Ist-Zustand${hinweise.length > 0 ? `, ⚠ ${hinweise.length} ohne Ziel im Ist-Zustand` : ''}`),
    el('details', {}, el('summary', {}, 'Abweichungen anzeigen'), abweichungenListe(ist, szenario)),
    el(
      'div', { class: 'knopfzeile' },
      el('button', { type: 'button', class: istAktiv ? '' : 'primaer', onClick: () => setzeAktivesSzenario(istAktiv ? null : szenario.id) }, istAktiv ? 'Zum Ist-Zustand' : 'Aktivieren'),
      el('a', { class: 'knopf', href: `#szenarien/${szenario.id}` }, 'Bearbeiten'),
      el('button', {
        type: 'button',
        onClick: async () => {
          const name = prompt('Name der Kopie:', `${szenario.name} (Kopie)`);
          if (name === null || name.trim() === '') return;
          await db.speichere('scenarios', kopiereSzenario(szenario, db.neueId, name.trim()));
          neuLaden();
        },
      }, 'Kopieren'),
      el('button', {
        type: 'button',
        onClick: async () => {
          const name = prompt('Neuer Name:', szenario.name);
          if (name === null || name.trim() === '') return;
          await db.speichere('scenarios', { ...szenario, name: name.trim() });
          neuLaden();
        },
      }, 'Umbenennen'),
      el('button', {
        type: 'button',
        class: 'gefahr',
        onClick: async () => {
          if (!confirm(`Szenario „${szenario.name}“ löschen? Der Ist-Zustand bleibt unverändert.`)) return;
          if (istAktiv) await setzeAktivesSzenario(null);
          await db.loesche('scenarios', szenario.id);
          neuLaden();
        },
      }, 'Löschen'),
    ),
  );
}

function vergleichsAnsicht(ist, szenarien) {
  if (szenarien.length === 0) return el('p', { class: 'leer' }, 'Sobald es Szenarien gibt, steht hier der Vergleich mit dem Ist-Zustand.');
  const vergleich = baueVergleich(ist, szenarien);
  const t = vergleichTabellen(vergleich);
  const hinweise = vergleich.spalten.filter((s) => s.szenarioHinweise.length > 0);
  return el(
    'div', {},
    el('h3', {}, 'Kennzahlen'),
    tabelle(t.kennzahlen),
    hinweise.length > 0
      ? el('div', { class: 'meldung warnung' }, el('strong', {}, 'Hinweise zu Abweichungen'), el('ul', {}, hinweise.flatMap((s) => s.szenarioHinweise.map((h) => el('li', {}, `${s.name}: ${h.text}`)))))
      : null,
    el('h3', {}, 'Räume'),
    el('p', { class: 'zeile' }, 'Heizlast als Mittelwert; die Vorlauftemperatur gilt für die ungünstige Heizlast.'),
    tabelle(t.raeume),
    el('h3', {}, 'Woher kommt die Änderung? Verluste nach Art'),
    el('p', { class: 'zeile' }, 'Mittelwert aus günstiger und ungünstiger Rechnung. Raum-zu-Raum-Ströme bleiben im Haus und sind nicht enthalten, die Summe entspricht der Gebäudeheizlast.'),
    tabelle(t.transmission),
  );
}

async function renderListe(container, neuLaden) {
  const [ist, szenarien, aktiv] = await Promise.all([ladeIstProjekt(), ladeSzenarien(), ladeAktivesSzenario()]);
  const neu = el('button', {
    type: 'button',
    class: 'primaer',
    onClick: async () => {
      const s = neuesSzenario(db.neueId());
      await db.speichere('scenarios', s);
      location.hash = `#szenarien/${s.id}`;
    },
  }, '+ Szenario');

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Szenarien'), neu),
    el(
      'p', { class: 'beschreibung' },
      'Ein Szenario beschreibt Abweichungen gegenüber dem Ist-Zustand, zum Beispiel ein gedämmtes Dach oder zusätzliche Heizkörper. '
      + 'Der Ist-Zustand wird dadurch nie verändert. Mit „Aktivieren“ zeigen Räume, Plan, Vorlauf und Bericht die Werte des Szenarios. '
      + 'Kopieren hilft, Kombinationen aufzubauen.',
    ),
    el(
      'ul', { class: 'szenarioliste' },
      el(
        'li', { class: `karte szenariokarte${aktiv ? '' : ' aktiv'}` },
        el('h3', {}, 'Ist-Zustand', aktiv ? null : el('span', { class: 'marke' }, 'aktiv')),
        el('p', { class: 'zeile' }, 'Die Bestandsdaten, so wie sie unter Räume, Bauteile und Heizkörper stehen.'),
        aktiv ? el('div', { class: 'knopfzeile' }, el('button', { type: 'button', onClick: () => setzeAktivesSzenario(null) }, 'Zum Ist-Zustand')) : null,
      ),
      ...szenarien.map((s) => szenarioKarte(ist, s, aktiv, neuLaden)),
    ),
    el('h2', {}, 'Vergleich'),
    vergleichsAnsicht(ist, szenarien),
  );
}

// --- Editor ------------------------------------------------------------------------------------

function bearbeiteNeuenHeizkoerper(ist, entwurf, heizkoerper, nachSpeichern) {
  const raum = ist.raeume.find((r) => r.id === heizkoerper.raumId);
  oeffneDialog({
    titel: `Szenario-Heizkörper in „${raum?.name ?? '?'}“`,
    felder: heizkoerperFelder(),
    werteVorgabe: { ...heizkoerper, kennlinieText: kennlinieZuText(heizkoerper.kennlinie), normWahl: normWahlVon(heizkoerper) },
    validiere: (gelesen) => validiereHeizkoerper(gelesen, OPTIONEN),
    ausnahmeSchutz: true,
    speichern: async (gelesen) => {
      const { kennlinieText, normWahl, ...rest } = gelesen;
      const neu = {
        ...rest, raumId: heizkoerper.raumId, kennlinie: parseKennlinie(kennlinieText).paare, id: rest.id ?? db.neueId(),
        name: `${label(BAUARTEN_HK, rest.bauart)} in „${raum?.name ?? '?'}“`,
      };
      const liste = entwurf.abweichungen.neueHeizkoerper;
      const index = liste.findIndex((h) => h.id === neu.id);
      if (index >= 0) liste[index] = neu; else liste.push(neu);
      nachSpeichern();
    },
  });
}

async function renderEditor(container, id) {
  const [ist, alle] = await Promise.all([ladeIstProjekt(), ladeSzenarien()]);
  const vorhanden = alle.find((s) => s.id === id);
  if (!vorhanden) {
    ersetzeKinder(container, el('p', { class: 'leer' }, 'Dieses Szenario gibt es nicht mehr.'), el('a', { class: 'knopf', href: '#szenarien' }, 'Zur Liste'));
    return;
  }
  const entwurf = kopie(normalisiereSzenario(vorhanden));
  const a = entwurf.abweichungen;
  const meldungsBereich = el('div', { class: 'meldungen', 'aria-live': 'polite' });
  const bereiche = el('div', {});
  let bestaetigt = false;
  const geaendert = () => { bestaetigt = false; speichernKnopf.textContent = 'Speichern'; };

  const nameVon = (liste, id2) => liste.find((x) => x.id === id2)?.name ?? null;
  const raumName = (id2) => nameVon(ist.raeume, id2);
  const fehlt = 'gibt es nicht mehr';

  // Auswahl „Eintrag hinzufügen“ für Abschnitte mit einer Zeile je Ziel.
  function hinzufuegen(kandidaten, beschriftung, anlegen) {
    if (kandidaten.length === 0) return el('p', { class: 'zeile' }, 'Alle möglichen Einträge sind schon aufgeführt.');
    let gewaehlt = kandidaten[0].wert;
    const wahl = auswahl(kandidaten, gewaehlt, (w) => { gewaehlt = w; }, beschriftung);
    return el('div', { class: 'knopfzeile' }, wahl, el('button', { type: 'button', onClick: () => { anlegen(gewaehlt); geaendert(); zeichne(); } }, '+ Hinzufügen'));
  }

  const abschnitt = (titel, text, ...inhalt) => el('section', { class: 'karte szenario-abschnitt' }, el('h3', {}, titel), text ? el('p', { class: 'zeile' }, text) : null, ...inhalt);
  const feldMitFehlerFlag = (wert, beiAenderung, beschriftung) => zahlFeld(wert, (w) => { beiAenderung(w); geaendert(); }, beschriftung);
  const zeileMitHinweis = (zeile, ziel) => (ziel === null ? [zeile] : [zeile, el('tr', {}, el('td', { class: 'hinweis-zeile', colspan: '4' }, `⚠ ${ziel} ${fehlt} im Ist-Zustand, die Abweichung wirkt nicht.`))]);

  function bauteileAbschnitt() {
    const zeilen = Object.entries(a.bauteile).flatMap(([bid, ov]) => {
      const b = ist.bauteile.find((x) => x.id === bid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, b?.name ?? ov.name ?? bid),
        el('td', { class: 'ist' }, b ? `${bereichText(b.u)} W/(m²K)` : '–'),
        el('td', {}, 'min ', feldMitFehlerFlag(ov.u?.min, (w) => { ov.u = { ...ov.u, min: w }; }, `U min ${ov.name}`), ' max ', feldMitFehlerFlag(ov.u?.max, (w) => { ov.u = { ...ov.u, max: w }; }, `U max ${ov.name}`)),
        el('td', {}, entfernenKnopf(() => { delete a.bauteile[bid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, b ? null : `Das Bauteil „${ov.name ?? bid}“`);
    });
    const frei = ist.bauteile.filter((b) => !a.bauteile[b.id]).map((b) => ({ wert: b.id, label: `${b.name} (Ist ${bereichText(b.u)})` }));
    return abschnitt(
      'Bauteile: U-Wert-Spanne', 'Überschreibt den U-Wert eines Bauteils aus dem Katalog in allen Flächen, die es nutzen. Bei sicherem Wert min und max gleich eintragen.',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Bauteil', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Bauteil hinzufügen', (bid) => { const b = ist.bauteile.find((x) => x.id === bid); a.bauteile[bid] = { name: b.name, u: { min: b.u.min, max: b.u.max } }; }),
    );
  }

  // Einzelnen Raumflächen ein anderes Bauteil aus dem Katalog zuweisen.
  function flaechenAbschnitt() {
    const bauteilOpt = ist.bauteile.map((b) => ({ wert: b.id, label: `${b.name} (U ${bereichText(b.u)})` }));
    const bauteilText = (id2) => { const b = ist.bauteile.find((x) => x.id === id2); return b ? `${b.name} (U ${bereichText(b.u)})` : null; };
    const flaechenText = (f) => {
      const flaeche = flaecheAusMassen(f);
      return `${raumName(f.raumId) ?? '?'}: ${flaechenBezeichnung(ist, f)}${Number.isFinite(flaeche) ? `, ${formatZahl(flaeche, 2)} m²` : ''}`;
    };

    const zeilen = Object.entries(a.flaechenBauteil).flatMap(([fid, ov]) => {
      const f = ist.flaechen.find((x) => x.id === fid);
      const neuOk = ist.bauteile.some((b) => b.id === ov.bauteilId);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, f ? flaechenText(f) : (ov.name ?? fid)),
        el('td', { class: 'ist' }, f ? (bauteilText(f.bauteilId) ?? 'Bauteil fehlt') : '–'),
        el('td', {}, auswahl(
          neuOk ? bauteilOpt : [{ wert: ov.bauteilId ?? '', label: `${ov.bauteilName ?? 'Bauteil'} (${fehlt})` }, ...bauteilOpt],
          ov.bauteilId ?? '',
          (w) => { ov.bauteilId = w; ov.bauteilName = ist.bauteile.find((b) => b.id === w)?.name ?? ov.bauteilName; geaendert(); zeichne(); },
          `Bauteil für ${ov.name ?? fid}`,
        )),
        el('td', {}, entfernenKnopf(() => { delete a.flaechenBauteil[fid]; geaendert(); zeichne(); })),
      );
      const meldung = !f ? `Die Raumfläche „${ov.name ?? fid}“ ${fehlt} im Ist-Zustand, die Abweichung wirkt nicht.`
        : (neuOk ? null : `Das neue Bauteil „${ov.bauteilName ?? '?'}“ ${fehlt} im Katalog, die Abweichung wirkt nicht.`);
      return meldung ? [zeile, el('tr', {}, el('td', { class: 'hinweis-zeile', colspan: '4' }, `⚠ ${meldung}`))] : [zeile];
    });

    // Flächen hinzufügen: nach Raum und Bauteil filtern, damit sich zum Beispiel alle Dachflächen auf einmal aufnehmen lassen.
    let raumFilter = '';
    let bauteilFilter = '';
    const raumWahl = auswahl([{ wert: '', label: 'alle Räume' }, ...ist.raeume.map((r) => ({ wert: r.id, label: r.name }))], '', (w) => { raumFilter = w; }, 'Flächen aus Raum');
    const bauteilWahl = auswahl([{ wert: '', label: 'alle Bauteile' }, ...ist.bauteile.map((b) => ({ wert: b.id, label: b.name }))], '', (w) => { bauteilFilter = w; }, 'Flächen mit Bauteil');
    const hinzu = el('button', {
      type: 'button',
      onClick: () => {
        const treffer = ist.flaechen.filter((f) => (!raumFilter || f.raumId === raumFilter) && (!bauteilFilter || f.bauteilId === bauteilFilter) && !a.flaechenBauteil[f.id]);
        for (const f of treffer) a.flaechenBauteil[f.id] = { name: flaechenText(f), bauteilId: f.bauteilId, bauteilName: ist.bauteile.find((b) => b.id === f.bauteilId)?.name ?? null };
        geaendert();
        zeichne();
      },
    }, '+ Flächen aufnehmen');

    // Allen aufgeführten Flächen auf einmal dasselbe Bauteil zuweisen.
    let sammelBauteil = bauteilOpt[0]?.wert ?? '';
    const sammelWahl = auswahl(bauteilOpt, sammelBauteil, (w) => { sammelBauteil = w; }, 'Bauteil für alle aufgeführten Flächen');
    const sammel = el('button', {
      type: 'button',
      onClick: () => {
        const b = ist.bauteile.find((x) => x.id === sammelBauteil);
        if (!b) return;
        for (const ov of Object.values(a.flaechenBauteil)) { ov.bauteilId = b.id; ov.bauteilName = b.name; }
        geaendert();
        zeichne();
      },
    }, 'Allen zuweisen');

    return abschnitt(
      'Flächen: Bauteil tauschen',
      'Weist einzelnen Raumflächen ein anderes Bauteil aus dem Katalog zu, zum Beispiel nur die Dachflächen bestimmter Räume dem Bauteil „Flachdach saniert“. Andere Flächen mit dem bisherigen Bauteil bleiben unverändert. Steht eine Wand in beiden Räumen, die Fläche in beiden tauschen.',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Fläche', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      zeilen.length > 0 ? el('div', { class: 'knopfzeile' }, sammelWahl, sammel) : null,
      el('h4', {}, 'Flächen aufnehmen'),
      el('div', { class: 'knopfzeile' }, raumWahl, bauteilWahl, hinzu),
      el('p', { class: 'hinweis' }, 'Die aufgenommenen Flächen behalten zunächst ihr bisheriges Bauteil. Wähle in der Zeile das neue Bauteil oder nutze „Allen zuweisen“.'),
    );
  }

  function oeffnungenAbschnitt() {
    const zeilen = Object.entries(a.oeffnungstypen).flatMap(([tid, ov]) => {
      const t = ist.oeffnungstypen.find((x) => x.id === tid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, t?.name ?? ov.name ?? tid),
        el('td', { class: 'ist' }, t ? `${zahlZuText(t.uw)} W/(m²K)` : '–'),
        el('td', {}, feldMitFehlerFlag(ov.uw, (w) => { ov.uw = w; }, `Uw ${ov.name}`), ' W/(m²K)'),
        el('td', {}, entfernenKnopf(() => { delete a.oeffnungstypen[tid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, t ? null : `Der Öffnungstyp „${ov.name ?? tid}“`);
    });
    const frei = ist.oeffnungstypen.filter((t) => !a.oeffnungstypen[t.id]).map((t) => ({ wert: t.id, label: `${t.name} (Ist ${zahlZuText(t.uw)})` }));
    return abschnitt(
      'Fenster und Türen: Uw', 'Überschreibt den Uw-Wert eines Öffnungstyps in allen Flächen, die ihn nutzen.',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Öffnungstyp', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Öffnungstyp hinzufügen', (tid) => { const t = ist.oeffnungstypen.find((x) => x.id === tid); a.oeffnungstypen[tid] = { name: t.name, uw: t.uw }; }),
    );
  }

  const hkTitel = (h) => `${raumName(h.raumId) ?? '?'}: ${label(BAUARTEN_HK, h.bauart)}${h.bauart === 'platten' && h.typ ? ` ${h.typ}` : ''}${h.normleistung ? `, ${zahlZuText(h.normleistung)} W` : ''}`;

  function heizkoerperAbschnitt() {
    const statusOpt = HK_STATI.map((s) => ({ wert: s.wert, label: s.label }));
    const zeilen = Object.entries(a.heizkoerperStatus).flatMap(([hid, ov]) => {
      const h = ist.heizkoerper.find((x) => x.id === hid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, h ? hkTitel(h) : (ov.name ?? hid)),
        el('td', { class: 'ist' }, h ? label(HK_STATI, h.status) : '–'),
        el('td', {}, auswahl(statusOpt, ov.status, (w) => { ov.status = w; geaendert(); }, `Status ${ov.name ?? hid}`)),
        el('td', {}, entfernenKnopf(() => { delete a.heizkoerperStatus[hid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, h ? null : `Der Heizkörper „${ov.name ?? hid}“`);
    });
    const frei = ist.heizkoerper.filter((h) => !a.heizkoerperStatus[h.id]).map((h) => ({ wert: h.id, label: `${hkTitel(h)} (${label(HK_STATI, h.status)})` }));

    const neueZeilen = a.neueHeizkoerper.flatMap((h) => {
      const raumOk = Boolean(raumName(h.raumId));
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, `${raumName(h.raumId) ?? h.name ?? '?'}: ${label(BAUARTEN_HK, h.bauart)}`),
        el('td', { class: 'ist' }, 'nicht vorhanden'),
        el('td', {}, `${label(HK_STATI, h.status)}, ${h.bauart === 'wp' ? `Kennlinie (${(h.kennlinie ?? []).length} Wertepaare)` : h.normleistung ? `${zahlZuText(h.normleistung)} W bei ${zahlZuText(h.normVorlauf)}/${zahlZuText(h.normRuecklauf)}/${zahlZuText(h.normRaum)}` : 'Leistung fehlt'} `,
          el('button', { type: 'button', class: 'klein', onClick: () => bearbeiteNeuenHeizkoerper(ist, entwurf, h, () => { geaendert(); zeichne(); }) }, 'Bearbeiten')),
        el('td', {}, entfernenKnopf(() => { a.neueHeizkoerper = a.neueHeizkoerper.filter((x) => x.id !== h.id); geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, raumOk ? null : `Der Raum „${h.name ?? h.raumId}“`);
    });
    const raumOpt = ist.raeume.filter((r) => r.status === 'beheizt').map((r) => ({ wert: r.id, label: r.name }));
    let neuerRaum = raumOpt[0]?.wert;
    const neuWahl = auswahl(raumOpt, neuerRaum, (w) => { neuerRaum = w; }, 'Raum für neuen Heizkörper');

    return abschnitt(
      'Heizkörper', 'Status eines vorhandenen Heizkörpers ändern (zum Beispiel „Bleibt“ zu „Entfällt“) und Heizkörper anlegen, die nur in diesem Szenario existieren.',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Heizkörper', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Heizkörper für Statusänderung', (hid) => { const h = ist.heizkoerper.find((x) => x.id === hid); a.heizkoerperStatus[hid] = { name: hkTitel(h), status: h.status }; }),
      el('h4', {}, 'Heizkörper nur in diesem Szenario'),
      neueZeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Raum und Bauart', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, neueZeilen))) : el('p', { class: 'zeile' }, 'Noch keine szenario-eigenen Heizkörper.'),
      raumOpt.length > 0
        ? el('div', { class: 'knopfzeile' }, neuWahl, el('button', {
          type: 'button',
          onClick: () => bearbeiteNeuenHeizkoerper(ist, entwurf, { ...neuerHeizkoerper(neuerRaum), status: 'neu' }, () => { geaendert(); zeichne(); }),
        }, '+ Neuer Heizkörper'))
        : el('p', { class: 'zeile' }, 'Es gibt keinen beheizten Raum.'),
    );
  }

  function raumAbschnitt() {
    const zeilen = Object.entries(a.raumTemperatur).flatMap(([rid, ov]) => {
      const r = ist.raeume.find((x) => x.id === rid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, r?.name ?? ov.name ?? rid),
        el('td', { class: 'ist' }, r ? `${zahlZuText(r.theta)} °C` : '–'),
        el('td', {}, feldMitFehlerFlag(ov.theta, (w) => { ov.theta = w; }, `Soll-Temperatur ${ov.name}`), ' °C'),
        el('td', {}, entfernenKnopf(() => { delete a.raumTemperatur[rid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, r ? null : `Der Raum „${ov.name ?? rid}“`);
    });
    const frei = ist.raeume.filter((r) => !a.raumTemperatur[r.id] && r.status !== 'unbeheizt').map((r) => ({ wert: r.id, label: `${r.name} (Ist ${zahlZuText(r.theta)} °C)` }));
    return abschnitt(
      'Räume: Soll-Temperatur', 'Überschreibt die Soll-Temperatur eines Raums (bei passiven Räumen die angenommene Temperatur).',
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Raum', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Raum hinzufügen', (rid) => { const r = ist.raeume.find((x) => x.id === rid); a.raumTemperatur[rid] = { name: r.name, theta: r.theta }; }),
    );
  }

  function luftwechselAbschnitt() {
    const istStandard = ist.einstellungen.luftwechselStandard;
    const standard = a.luftwechselStandard
      ? el(
        'div', { class: 'knopfzeile' },
        el('span', {}, 'Standard-Luftwechsel: min '), feldMitFehlerFlag(a.luftwechselStandard.min, (w) => { a.luftwechselStandard.min = w; }, 'Standard-Luftwechsel min'),
        el('span', {}, ' max '), feldMitFehlerFlag(a.luftwechselStandard.max, (w) => { a.luftwechselStandard.max = w; }, 'Standard-Luftwechsel max'), ' 1/h',
        entfernenKnopf(() => { a.luftwechselStandard = null; geaendert(); zeichne(); }),
      )
      : el('div', { class: 'knopfzeile' }, el('button', { type: 'button', onClick: () => { a.luftwechselStandard = { min: istStandard.min, max: istStandard.max }; geaendert(); zeichne(); } }, 'Standard-Luftwechsel überschreiben'));

    const zeilen = Object.entries(a.luftwechselRaum).flatMap(([rid, ov]) => {
      const r = ist.raeume.find((x) => x.id === rid);
      const zeile = el(
        'tr', {},
        el('th', { scope: 'row' }, r?.name ?? ov.name ?? rid),
        el('td', { class: 'ist' }, r ? (r.luftwechsel ? `${bereichText(r.luftwechsel)} 1/h` : `Standard ${bereichText(istStandard)} 1/h`) : '–'),
        el('td', {}, 'min ', feldMitFehlerFlag(ov.min, (w) => { ov.min = w; }, `Luftwechsel min ${ov.name}`), ' max ', feldMitFehlerFlag(ov.max, (w) => { ov.max = w; }, `Luftwechsel max ${ov.name}`)),
        el('td', {}, entfernenKnopf(() => { delete a.luftwechselRaum[rid]; geaendert(); zeichne(); })),
      );
      return zeileMitHinweis(zeile, r ? null : `Der Raum „${ov.name ?? rid}“`);
    });
    const frei = ist.raeume.filter((r) => !a.luftwechselRaum[r.id] && r.status !== 'unbeheizt').map((r) => ({ wert: r.id, label: r.name }));
    return abschnitt(
      'Luftwechsel', `Ist-Zustand: Standard ${bereichText(istStandard)} 1/h. Ein Wert für einen Raum geht dem Standard vor.`,
      standard,
      zeilen.length > 0 ? el('div', { class: 'tabellenrahmen' }, el('table', { class: 'tabelle szenario-tabelle' }, el('thead', {}, el('tr', {}, ['Raum', 'Ist-Zustand', 'Szenario', ''].map((k) => el('th', {}, k)))), el('tbody', {}, zeilen))) : null,
      hinzufuegen(frei, 'Raum für Luftwechsel hinzufügen', (rid) => {
        const r = ist.raeume.find((x) => x.id === rid);
        const basis = r.luftwechsel ?? istStandard;
        a.luftwechselRaum[rid] = { name: r.name, min: basis.min, max: basis.max };
      }),
    );
  }

  function einstellungenAbschnitt() {
    const zeile = (schluessel, name, istText, einheit, anfang) => {
      const an = a.einstellungen[schluessel] !== undefined;
      return el(
        'div', { class: 'knopfzeile' },
        el('span', {}, `${name} (Ist ${istText}): `),
        an
          ? [feldMitFehlerFlag(a.einstellungen[schluessel], (w) => { a.einstellungen[schluessel] = w; }, name), ` ${einheit} `, entfernenKnopf(() => { delete a.einstellungen[schluessel]; geaendert(); zeichne(); })]
          : el('button', { type: 'button', onClick: () => { a.einstellungen[schluessel] = anfang; geaendert(); zeichne(); } }, 'Überschreiben'),
      );
    };
    return abschnitt(
      'Einstellungen', null,
      zeile('zielVorlauf', 'Ziel-Vorlauftemperatur', `${zahlZuText(ist.einstellungen.zielVorlauf ?? 45)} °C`, '°C', ist.einstellungen.zielVorlauf ?? 45),
      zeile('spreizung', 'Spreizung', `${zahlZuText(ist.einstellungen.spreizung)} K`, 'K', ist.einstellungen.spreizung),
    );
  }

  function zeichne() {
    ersetzeKinder(bereiche, bauteileAbschnitt(), flaechenAbschnitt(), oeffnungenAbschnitt(), heizkoerperAbschnitt(), raumAbschnitt(), luftwechselAbschnitt(), einstellungenAbschnitt());
  }

  const speichernKnopf = el('button', { type: 'button', class: 'primaer' }, 'Speichern');
  speichernKnopf.addEventListener('click', async () => {
    const meldungen = validiereSzenario(entwurf);
    ersetzeKinder(meldungsBereich, meldungen.map((m) => el('p', { class: `meldung ${m.stufe === 'fehler' ? 'fehler' : 'warnung'}` }, `${m.stufe === 'fehler' ? '✗' : '⚠'} ${m.text}`)));
    if (hatFehler(meldungen)) return;
    if (hatWarnungen(meldungen) && !bestaetigt) {
      bestaetigt = true;
      speichernKnopf.textContent = 'Trotzdem speichern';
      return;
    }
    await db.speichere('scenarios', entwurf);
    location.hash = '#szenarien';
  });

  const name = el('input', { type: 'text', value: entwurf.name, 'aria-label': 'Name des Szenarios' });
  name.addEventListener('input', () => { entwurf.name = name.value; geaendert(); });
  const beschreibung = el('textarea', { rows: 3, 'aria-label': 'Beschreibung' });
  beschreibung.value = entwurf.beschreibung;
  beschreibung.addEventListener('input', () => { entwurf.beschreibung = beschreibung.value; geaendert(); });

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Szenario bearbeiten'), el('a', { class: 'knopf', href: '#szenarien' }, 'Zurück zur Liste')),
    el('p', { class: 'beschreibung' }, 'Links steht jeweils der Ist-Wert, rechts der Wert im Szenario. Der Ist-Zustand wird hier nie geändert.'),
    el('section', { class: 'karte' }, el('label', {}, el('span', { class: 'klein' }, 'Name'), name), el('label', {}, el('span', { class: 'klein' }, 'Beschreibung'), beschreibung)),
    bereiche,
    meldungsBereich,
    el('div', { class: 'knopfzeile' }, speichernKnopf, el('a', { class: 'knopf', href: '#szenarien' }, 'Abbrechen')),
  );
  zeichne();
}

export async function renderSzenarien(container, id, neuLaden) {
  if (id) await renderEditor(container, id);
  else await renderListe(container, neuLaden);
}
