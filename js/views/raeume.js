// Räume: Liste mit Gebäudeheizlast und Gegenprobe, Raumdetail mit Raumflächen und Öffnungen.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { oeffneDialog } from '../dialog.js';
import { ladeProjekt, rechne } from '../daten.js';
import { formatZahl, formatBereich, zahlZuText } from '../engine/format.js';
import { GEGENPROBE_TOLERANZ_W } from '../engine/heatload.js';
import {
  flaecheAusMassen, oeffnungsGesamtflaeche, nettoFlaeche, raumVolumen, wahlZuAngrenzend, angrenzendZuWahl,
} from '../modell.js';
import { validiereRaumEingabe, validiereFlaeche, validiereOeffnungEintrag } from '../validate.js';
import {
  STATI, GESCHOSSE, werte, label, neuerRaum, raumFelder, neueFlaeche, flaechenFelder, neueOeffnung, oeffnungsEintragFelder,
} from '../schemas.js';

// --- Anzeige-Hilfen ------------------------------------------------------------------

const watt = (x) => `${formatZahl(x, 0)} W`;
const wattBereich = (a, b) => `${formatBereich(a, b, 0)} W`;
const FALL_NAME = { guenstig: 'günstig', ungunstig: 'ungünstig' };

const raumName = (projekt, id) => projekt.raeume.find((r) => r.id === id)?.name ?? 'nicht mehr vorhandener Raum';

function flaechenBezeichnung(projekt, flaeche) {
  const bauteil = projekt.bauteile.find((b) => b.id === flaeche.bauteilId);
  return flaeche.name || bauteil?.name || 'Fläche';
}

function angrenzendText(projekt, angrenzend) {
  if (!angrenzend || angrenzend.art === 'aussen') return 'Außenluft';
  if (angrenzend.art === 'zone') {
    const zone = projekt.zonen.find((z) => z.id === angrenzend.zoneId);
    if (!zone) return 'Zone nicht mehr vorhanden';
    const t = zone.temperatur;
    return `Zone „${zone.name}“ (${t.min === t.max ? zahlZuText(t.min) : `${zahlZuText(t.min)} bis ${zahlZuText(t.max)}`} °C)`;
  }
  const raum = projekt.raeume.find((r) => r.id === angrenzend.raumId);
  if (!raum) return 'Raum nicht mehr vorhanden';
  return `Raum „${raum.name}“${typeof raum.theta === 'number' ? ` (${zahlZuText(raum.theta)} °C)` : ''}`;
}

function massText(m) {
  const flaeche = flaecheAusMassen(m);
  if (m.modus === 'flaeche') return `${formatZahl(flaeche, 2)} m²`;
  return `${formatZahl(m.laenge, 2)} m × ${formatZahl(m.hoehe, 2)} m = ${formatZahl(flaeche, 2)} m²`;
}

// Erklärt, warum ein Raum-zu-Raum-Verlust nicht angerechnet wird.
function grundText(projekt, eintrag) {
  const nachbar = raumName(projekt, eintrag.nachbarId);
  switch (eintrag.grund) {
    case 'nachbar_waermer': return `„${nachbar}“ ist wärmer: keine Gutschrift`;
    case 'gleiche_temperatur': return `„${nachbar}“ hat dieselbe Temperatur: kein Wärmestrom`;
    case 'nachbar_passiv': return `„${nachbar}“ ist passiv mitbeheizt: über die Zurechnung seines Verlusts berücksichtigt`;
    case 'nachbar_unbeheizt': return `„${nachbar}“ ist ein unbeheizter Raum: bitte stattdessen eine Zone verwenden`;
    default: return 'grenzt an einen nicht mehr vorhandenen Raum';
  }
}

// Meldungen aus Rechenkern und Modell in Klartext.
function meldungsTexte(projekt, ergebnis, hinweise) {
  const texte = [];
  for (const w of ergebnis?.warnungen ?? []) {
    if (w.art === 'gegenprobe') {
      const betrag = formatZahl(Math.abs(w.differenz), 1);
      texte.push({
        stufe: 'fehler',
        text: `Gegenprobe (${FALL_NAME[w.fall]}): Die Raumheizlasten weichen um ${betrag} W von der Gebäudesumme ab, `
          + `${w.differenz > 0 ? `es fehlen ${betrag} W in den Raumheizlasten` : `${betrag} W sind doppelt gezählt`}. `
          + 'Meist stimmt die Verteilung eines passiven Raums nicht auf 100 %.',
      });
    } else if (w.art === 'passiv_verteilung') {
      texte.push({
        stufe: 'warnung',
        text: `Passiver Raum „${raumName(projekt, w.raumId)}“: Die Wärmelieferanten ergeben ${formatZahl(w.summe, 1)} % statt 100 %.`,
      });
    } else if (w.art === 'lieferant_kein_beheizter_raum') {
      texte.push({
        stufe: 'warnung',
        text: `Passiver Raum „${raumName(projekt, w.raumId)}“: „${raumName(projekt, w.lieferantId)}“ ist kein beheizter Raum und liefert keine Wärme.`,
      });
    } else if (w.art === 'gegenraum_unbrauchbar') {
      texte.push({
        stufe: 'warnung',
        text: `Raum „${raumName(projekt, w.raumId)}“: Eine Fläche grenzt an ${w.grund === 'nachbar_unbeheizt'
          ? 'einen unbeheizten Raum (bitte stattdessen eine Zone verwenden)' : 'einen nicht mehr vorhandenen Raum'}.`,
      });
    }
  }
  for (const h of hinweise) {
    const raum = `„${raumName(projekt, h.raumId)}“`;
    const flaeche = h.flaecheId ? projekt.flaechen.find((f) => f.id === h.flaecheId) : null;
    const wo = flaeche ? `${raum}, ${flaechenBezeichnung(projekt, flaeche)}` : raum;
    const nachricht = {
      bauteil_fehlt: `${wo}: Das Bauteil fehlt im Katalog. Die Fläche wird nicht gerechnet.`,
      zone_fehlt: `${wo}: Die Zone gibt es nicht mehr. Die Fläche wird nicht gerechnet.`,
      masse_ungueltig: `${wo}: Die Maße sind unvollständig. Die Fläche wird nicht gerechnet.`,
      oeffnung_unvollstaendig: `${wo}: Eine Öffnung ist unvollständig und wird ausgelassen.`,
      oeffnungen_zu_gross: `${wo}: Die Öffnungen sind größer als die Fläche. Die Fläche wird nicht gerechnet.`,
      raum_unvollstaendig: `${raum}: Fläche, Höhe oder Temperatur fehlt. Der Raum wird nicht gerechnet.`,
      gegenseite_fehlt: `${raum} führt eine Wand zum wärmeren Raum „${raumName(projekt, h.nachbarId)}“, `
        + `aber „${raumName(projekt, h.nachbarId)}“ führt keine Fläche zu „${raumName(projekt, h.raumId)}“. `
        + 'Der Wärmeverlust des wärmeren Raums an diese Wand wird dadurch nicht angerechnet.',
    }[h.art];
    if (nachricht) texte.push({ stufe: 'warnung', text: nachricht });
  }
  return texte;
}

const meldungsBlock = (texte) => texte.map((t) => el('p', { class: `meldung ${t.stufe}` }, `⚠ ${t.text}`));

function tabelle(kopf, zeilen) {
  return el(
    'table', { class: 'tabelle' },
    el('thead', {}, el('tr', {}, kopf.map((k, i) => el('th', { class: i > 0 ? 'zahl' : '' }, k)))),
    el('tbody', {}, zeilen.map((z) => el(
      'tr', { class: z.klasse },
      z.zellen.map((zelle, i) => el(i === 0 ? 'th' : 'td', { class: i > 0 ? 'zahl' : '', scope: i === 0 ? 'row' : undefined }, zelle)),
    ))),
  );
}

// --- Verlustlisten je Raum -----------------------------------------------------------

// Angerechnete Raum-zu-Raum-Verluste eines Raums (günstig bis ungünstig), dazu die Flächen, die nichts beitragen.
function raumZuRaumListe(projekt, r, mitGruenden) {
  const liste = r.guenstig.raumZuRaum.map((g) => {
    const u = r.ungunstig.raumZuRaum.find((x) => x.flaecheId === g.flaecheId) ?? g;
    const flaeche = projekt.flaechen.find((f) => f.id === g.flaecheId);
    const bezeichnung = flaeche ? `${flaechenBezeichnung(projekt, flaeche)} · ` : '';
    return el('li', {}, `${bezeichnung}an „${raumName(projekt, g.nachbarId)}“: `, el('strong', {}, wattBereich(g.leistung, u.leistung)));
  });
  const nicht = mitGruenden
    ? r.guenstig.nichtAngerechnet.map((n) => el('li', { class: 'leise' }, `nicht angerechnet: ${grundText(projekt, n)}`))
    : [];
  return el(
    'div', { class: 'raumzuraum' },
    el('p', { class: 'beschriftung' }, 'Angerechnete Raum-zu-Raum-Verluste'),
    liste.length > 0 ? el('ul', {}, liste) : el('p', { class: 'zeile' }, 'keine'),
    nicht.length > 0 ? el('ul', {}, nicht) : null,
  );
}

// Anteile passiver Räume, die einem beheizten Raum zugerechnet werden (günstig bis ungünstig).
function passiveAnteile(projekt, ergebnis, raumId) {
  const anteile = [];
  for (const p of ergebnis.raeume.filter((r) => r.status === 'passiv')) {
    const eintrag = projekt.raeume.find((r) => r.id === p.id)?.waermeLieferanten?.find((l) => l.raumId === raumId);
    if (!eintrag) continue;
    anteile.push({
      name: p.name, prozent: eintrag.prozent,
      von: (p.guenstig.netto * eintrag.prozent) / 100, bis: (p.ungunstig.netto * eintrag.prozent) / 100,
    });
  }
  return anteile;
}

// --- Raum anlegen, bearbeiten, löschen -----------------------------------------------

function validiereRaumMitVerteilung(gelesen) {
  const meldungen = validiereRaumEingabe(gelesen, { stati: werte(STATI), geschosse: werte(GESCHOSSE) });
  let summe = 0;
  for (const [id, wert] of Object.entries(gelesen.lieferant ?? {})) {
    if (wert === null) continue;
    if (!Number.isFinite(wert) || wert < 0 || wert > 100) {
      meldungen.push({ feld: `lieferant.${id}`, stufe: 'fehler', text: 'Anteil: bitte eine Zahl von 0 bis 100 eingeben.' });
    } else {
      summe += wert;
    }
  }
  if (gelesen.status === 'passiv' && Math.abs(summe - 100) > 0.01) {
    meldungen.push({
      feld: '_lieferanten', stufe: 'warnung',
      text: `Die Anteile ergeben ${formatZahl(summe, 1)} % statt 100 %. Der Rest des Wärmebedarfs fehlt dann in den Raumheizlasten.`,
    });
  }
  return meldungen;
}

function bearbeiteRaum(projekt, raum, neuLaden) {
  const kandidaten = projekt.raeume.filter((r) => r.status === 'beheizt' && r.id !== raum.id);
  const vorgabe = {
    ...raum,
    lieferant: Object.fromEntries((raum.waermeLieferanten ?? []).map((l) => [l.raumId, l.prozent])),
  };
  oeffneDialog({
    titel: raum.id ? 'Raum bearbeiten' : 'Raum anlegen',
    felder: raumFelder(kandidaten),
    werteVorgabe: vorgabe,
    validiere: validiereRaumMitVerteilung,
    speichern: async (gelesen) => {
      const { lieferant, ...rest } = gelesen;
      const waermeLieferanten = gelesen.status === 'passiv'
        ? Object.entries(lieferant ?? {}).filter(([, prozent]) => prozent > 0).map(([raumId, prozent]) => ({ raumId, prozent }))
        : [];
      await db.speichere('rooms', { ...rest, waermeLieferanten, id: rest.id ?? db.neueId() });
      neuLaden();
    },
  });
}

async function loescheRaum(projekt, raum, neuLaden) {
  const eigene = projekt.flaechen.filter((f) => f.raumId === raum.id);
  const fremde = projekt.flaechen.filter((f) => f.raumId !== raum.id && f.angrenzend?.raumId === raum.id);
  const lieferanten = projekt.raeume.filter((r) => r.waermeLieferanten?.some((l) => l.raumId === raum.id));
  const zeilen = [`Raum „${raum.name}“ mit ${eigene.length} Raumfläche${eigene.length === 1 ? '' : 'n'} löschen?`];
  if (fremde.length > 0) {
    zeilen.push(`${fremde.length} Fläche${fremde.length === 1 ? '' : 'n'} in anderen Räumen grenz${fremde.length === 1 ? 't' : 'en'} an diesen Raum und werden danach markiert.`);
  }
  if (lieferanten.length > 0) {
    zeilen.push(`Er wird aus der Wärmeverteilung von ${lieferanten.map((r) => `„${r.name}“`).join(', ')} entfernt.`);
  }
  if (!confirm(zeilen.join('\n\n'))) return;

  for (const f of eigene) await db.loesche('surfaces', f.id);
  for (const r of lieferanten) {
    await db.speichere('rooms', { ...r, waermeLieferanten: r.waermeLieferanten.filter((l) => l.raumId !== raum.id) });
  }
  await db.loesche('rooms', raum.id);
  location.hash = '#raeume';
  neuLaden();
}

// --- Raumflächen und Öffnungen -------------------------------------------------------

function brauchtErst(was, ziel) {
  alert(`Lege zuerst unter „${ziel}“ ${was} an.`);
}

// Kopie einer Wand für den anderen Raum, mit eigenen IDs. Zählt nur im wärmeren Raum.
function spiegelFlaeche(flaeche, ursprungRaumId) {
  return {
    ...flaeche,
    id: db.neueId(),
    raumId: flaeche.angrenzend.raumId,
    angrenzend: { art: 'raum', raumId: ursprungRaumId },
    oeffnungen: (flaeche.oeffnungen ?? []).map((o) => ({ ...o, id: db.neueId() })),
  };
}

function oeffnungenZuGross(flaeche, oeffnungen) {
  const brutto = flaecheAusMassen(flaeche);
  const summe = oeffnungen.reduce((s, o) => s + oeffnungsGesamtflaeche(o), 0);
  return Number.isFinite(brutto) && Number.isFinite(summe) && summe > brutto + 1e-9 ? { brutto, summe } : null;
}

function bearbeiteFlaeche(projekt, raum, flaeche, neuLaden) {
  if (projekt.bauteile.length === 0) return brauchtErst('ein Bauteil', 'Bauteile');
  const istNeu = !flaeche.id;
  const felder = flaechenFelder({
    bauteile: projekt.bauteile,
    zonen: projekt.zonen,
    raeume: projekt.raeume.filter((r) => r.id !== raum.id),
  });
  const optionen = {
    bauteilIds: projekt.bauteile.map((b) => b.id),
    angrenzendWerte: felder.find((f) => f.key === 'angrenzendWahl').optionen.map((o) => o.wert),
  };
  const vorgabe = { ...flaeche, angrenzendWahl: angrenzendZuWahl(flaeche.angrenzend), spiegeln: istNeu };

  oeffneDialog({
    titel: istNeu ? `Raumfläche in „${raum.name}“` : 'Raumfläche bearbeiten',
    felder,
    werteVorgabe: vorgabe,
    validiere: (gelesen) => {
      const meldungen = validiereFlaeche(gelesen, optionen);
      const zuGross = oeffnungenZuGross(gelesen, gelesen.oeffnungen ?? []);
      if (zuGross) {
        meldungen.push({
          feld: gelesen.modus === 'flaeche' ? 'flaeche' : 'laenge', stufe: 'fehler',
          text: `Die Öffnungen (${formatZahl(zuGross.summe, 2)} m²) sind größer als die Fläche (${formatZahl(zuGross.brutto, 2)} m²).`,
        });
      }
      return meldungen;
    },
    speichern: async (gelesen) => {
      const { angrenzendWahl, spiegeln, ...rest } = gelesen;
      const gespeichert = { ...rest, angrenzend: wahlZuAngrenzend(angrenzendWahl), id: rest.id ?? db.neueId() };
      await db.speichere('surfaces', gespeichert);
      if (istNeu && spiegeln && gespeichert.angrenzend.art === 'raum') {
        await db.speichere('surfaces', spiegelFlaeche(gespeichert, raum.id));
      }
      neuLaden();
    },
  });
}

function bearbeiteOeffnung(projekt, flaeche, index, neuLaden) {
  if (projekt.oeffnungstypen.length === 0) return brauchtErst('einen Öffnungstyp', 'Öffnungen');
  const vorhanden = flaeche.oeffnungen ?? [];
  const vorgabe = index >= 0 ? vorhanden[index] : neueOeffnung();
  oeffneDialog({
    titel: index >= 0 ? 'Öffnung bearbeiten' : 'Öffnung hinzufügen',
    felder: oeffnungsEintragFelder({ oeffnungstypen: projekt.oeffnungstypen }),
    werteVorgabe: vorgabe,
    validiere: (gelesen) => {
      const meldungen = validiereOeffnungEintrag(gelesen, { typIds: projekt.oeffnungstypen.map((t) => t.id) });
      const liste = vorhanden.map((o, i) => (i === index ? gelesen : o));
      if (index < 0) liste.push(gelesen);
      const zuGross = oeffnungenZuGross(flaeche, liste);
      if (zuGross) {
        meldungen.push({
          feld: 'anzahl', stufe: 'fehler',
          text: `Alle Öffnungen zusammen (${formatZahl(zuGross.summe, 2)} m²) wären größer als die Fläche (${formatZahl(zuGross.brutto, 2)} m²).`,
        });
      }
      return meldungen;
    },
    speichern: async (gelesen) => {
      const eintrag = { ...gelesen, id: gelesen.id ?? db.neueId() };
      const liste = [...vorhanden];
      if (index >= 0) liste[index] = eintrag; else liste.push(eintrag);
      await db.speichere('surfaces', { ...flaeche, oeffnungen: liste });
      neuLaden();
    },
  });
}

function flaechenKarte(projekt, raum, flaeche, ergebnisRaum, neuLaden) {
  const bauteil = projekt.bauteile.find((b) => b.id === flaeche.bauteilId);
  const brutto = flaecheAusMassen(flaeche);
  const verlust = ergebnisRaum
    ? ['guenstig', 'ungunstig'].map((fall) => {
      const f = ergebnisRaum[fall].flaechen.find((x) => x.id === flaeche.id);
      return f ? f.wand + f.oeffnungen + f.raumZuRaum : null;
    })
    : [null, null];
  const oeffnungen = flaeche.oeffnungen ?? [];

  return el(
    'article', { class: bauteil ? 'karte' : 'karte markiert' },
    el('h3', {}, flaechenBezeichnung(projekt, flaeche), bauteil ? null : el('span', { class: 'marke' }, '⚠ Bauteil fehlt')),
    el('p', { class: 'zeile' }, `Bauteil: ${bauteil ? bauteil.name : 'nicht mehr im Katalog'}`),
    el('p', { class: 'zeile' }, `Grenzt an: ${angrenzendText(projekt, flaeche.angrenzend)}`),
    el('p', { class: 'zeile' }, `Maße: ${Number.isFinite(brutto) ? massText(flaeche) : 'unvollständig'}`),
    oeffnungen.length > 0 ? el('p', { class: 'zeile' }, `Netto nach Abzug der Öffnungen: ${formatZahl(nettoFlaeche(flaeche), 2)} m²`) : null,
    oeffnungen.length > 0
      ? el('ul', { class: 'oeffnungen' }, oeffnungen.map((o, index) => {
        const typ = projekt.oeffnungstypen.find((t) => t.id === o.typId);
        return el(
          'li', {},
          el(
            'span', {},
            `${o.anzahl} × ${typ ? typ.name : 'Öffnungstyp fehlt'}${o.name ? ` „${o.name}“` : ''}: `,
            `${massText(o)} → ${formatZahl(oeffnungsGesamtflaeche(o), 2)} m²`,
          ),
          el('button', { type: 'button', class: 'klein', onClick: () => bearbeiteOeffnung(projekt, flaeche, index, neuLaden) }, 'Bearbeiten'),
          el('button', {
            type: 'button', class: 'klein gefahr',
            onClick: async () => {
              if (!confirm('Diese Öffnung löschen?')) return;
              await db.speichere('surfaces', { ...flaeche, oeffnungen: oeffnungen.filter((_, i) => i !== index) });
              neuLaden();
            },
          }, 'Löschen'),
        );
      }))
      : null,
    verlust[0] !== null
      ? el('p', { class: 'zeile' }, 'Verlust dieser Fläche: ', el('strong', {}, wattBereich(verlust[0], verlust[1])))
      : null,
    el(
      'div', { class: 'knopfzeile' },
      el('button', { type: 'button', onClick: () => bearbeiteFlaeche(projekt, raum, flaeche, neuLaden) }, 'Bearbeiten'),
      el('button', { type: 'button', onClick: () => bearbeiteOeffnung(projekt, flaeche, -1, neuLaden) }, '+ Öffnung'),
      el('button', {
        type: 'button',
        onClick: () => bearbeiteFlaeche(projekt, raum, {
          ...flaeche, id: undefined, name: `${flaeche.name || flaechenBezeichnung(projekt, flaeche)} (Kopie)`,
          oeffnungen: oeffnungen.map((o) => ({ ...o, id: db.neueId() })),
        }, neuLaden),
      }, 'Kopieren'),
      el('button', {
        type: 'button', class: 'gefahr',
        onClick: async () => {
          if (!confirm(`Raumfläche „${flaechenBezeichnung(projekt, flaeche)}“ löschen?`)) return;
          await db.loesche('surfaces', flaeche.id);
          neuLaden();
        },
      }, 'Löschen'),
    ),
  );
}

// --- Ansicht: Raumliste ----------------------------------------------------------------

function gebaeudeBlock(ergebnis) {
  const { guenstig: g, ungunstig: u, mittel } = ergebnis.gebaeude;
  const zeile = (name, a, b, stellen = 0, klasse) => ({
    zellen: [name, `${formatZahl(a, stellen)} W`, `${formatZahl(b, stellen)} W`], klasse,
  });
  const abweichend = (d) => (Math.abs(d) > GEGENPROBE_TOLERANZ_W ? 'abweichung' : '');
  return el(
    'section', { class: 'karte gebaeude' },
    el('h3', {}, 'Gebäudeheizlast'),
    el('p', { class: 'gross' }, wattBereich(g.summe, u.summe)),
    el('p', { class: 'zeile' }, `von günstig bis ungünstig · Mittelwert ${watt(mittel.summe)}`),
    el('p', { class: 'beschriftung' }, 'Gegenprobe'),
    tabelle(['', 'günstig', 'ungünstig'], [
      zeile('Gebäudesumme, direkt aus Hüllflächen und Lüftung', g.summe, u.summe),
      zeile('+ angerechnete Raum-zu-Raum-Verluste', g.raumZuRaum, u.raumZuRaum),
      zeile('= erwartete Summe der Raumheizlasten', g.summe + g.raumZuRaum, u.summe + u.raumZuRaum),
      zeile('Summe der Raumheizlasten (beheizte Räume)', g.heizlast, u.heizlast),
      zeile('Differenz', g.differenz, u.differenz, 1, abweichend(Math.max(Math.abs(g.differenz), Math.abs(u.differenz)))),
    ]),
    el(
      'p', { class: 'hinweis' },
      'Die Raumsumme darf um die Raum-zu-Raum-Verluste größer sein als die Gebäudesumme, denn diese Ströme zählen nur in den Räumen. '
      + 'Die Differenz muss null sein.',
    ),
  );
}

function raumKarte(projekt, ergebnis, raum, neuLaden) {
  const r = ergebnis?.raeume.find((x) => x.id === raum.id) ?? null;
  const volumen = raumVolumen(raum);
  const kopfzeile = [
    raum.geschoss,
    typeof raum.theta === 'number' ? `${zahlZuText(raum.theta)} °C` : null,
    Number.isFinite(raum.flaeche) ? `${formatZahl(raum.flaeche, 2)} m²` : null,
    Number.isFinite(volumen) ? `${formatZahl(volumen, 1)} m³` : null,
  ].filter(Boolean).join(' · ');

  let inhalt;
  if (!r) {
    inhalt = [el('p', { class: 'zeile' }, raum.status === 'unbeheizt' ? 'Wird nicht gerechnet (unbeheizt).' : 'Nicht gerechnet, siehe Hinweise oben.')];
  } else if (raum.status === 'passiv') {
    const lieferanten = (raum.waermeLieferanten ?? []).map((l) => `${raumName(projekt, l.raumId)} ${zahlZuText(l.prozent)} %`);
    inhalt = [
      el('p', { class: 'zeile' }, 'Netto-Verlust: ', el('strong', {}, wattBereich(r.guenstig.netto, r.ungunstig.netto)), ` (Mittel ${watt(r.mittel.netto)})`),
      el('p', { class: 'zeile' }, `Wärme liefern: ${lieferanten.length > 0 ? lieferanten.join(', ') : 'keine Zuordnung'}`),
      raumZuRaumListe(projekt, r, false),
    ];
  } else {
    const anteile = passiveAnteile(projekt, ergebnis, raum.id);
    inhalt = [
      el('p', { class: 'zeile' }, 'Heizlast: ', el('strong', {}, wattBereich(r.guenstig.heizlast, r.ungunstig.heizlast)), ` (Mittel ${watt(r.mittel.heizlast)})`),
      anteile.length > 0
        ? el('p', { class: 'zeile' }, `Davon von passiven Räumen: ${anteile.map((a) => `${a.name} ${zahlZuText(a.prozent)} % = ${wattBereich(a.von, a.bis)}`).join(', ')}`)
        : null,
      raumZuRaumListe(projekt, r, false),
    ];
  }

  return el(
    'article', { class: 'karte' },
    el('h3', {}, raum.name, el('span', { class: raum.status === 'beheizt' ? 'marke ruhig' : 'marke' }, label(STATI, raum.status))),
    el('p', { class: 'zeile' }, kopfzeile),
    ...inhalt,
    raum.notiz ? el('p', { class: 'zeile notiz' }, raum.notiz) : null,
    el(
      'div', { class: 'knopfzeile' },
      el('a', { class: 'knopf primaer', href: `#raum/${raum.id}` }, 'Flächen & Details'),
      el('button', { type: 'button', onClick: () => bearbeiteRaum(projekt, raum, neuLaden) }, 'Bearbeiten'),
      el('button', { type: 'button', class: 'gefahr', onClick: () => loescheRaum(projekt, raum, neuLaden) }, 'Löschen'),
    ),
  );
}

export async function renderRaeume(container, neuLaden) {
  const projekt = await ladeProjekt();
  const { ergebnis, hinweise, fehler } = rechne(projekt);

  const meldungen = meldungsTexte(projekt, ergebnis, hinweise);
  ersetzeKinder(container, 
    el(
      'div', { class: 'kopf' },
      el('h2', {}, 'Räume'),
      el('button', { type: 'button', class: 'primaer', onClick: () => bearbeiteRaum(projekt, neuerRaum(), neuLaden) }, '+ Raum'),
    ),
    el(
      'p', { class: 'beschreibung' },
      'Jeder Raum hat Raumflächen mit Bauteil und Gegenseite. Die Heizlast erscheint als Bandbreite von der günstigen bis zur ungünstigen Rechnung.',
    ),
    fehler ? el('p', { class: 'meldung fehler' }, `Rechenfehler: ${fehler}`) : null,
    ...meldungsBlock(meldungen),
    ergebnis && ergebnis.raeume.length > 0 ? gebaeudeBlock(ergebnis) : null,
    projekt.raeume.length > 0
      ? el('div', { class: 'karten' }, projekt.raeume.map((raum) => raumKarte(projekt, ergebnis, raum, neuLaden)))
      : el('p', { class: 'leer' }, 'Noch keine Räume. Lege zuerst unter „Bauteile“ und „Zonen“ die Grundlagen an, dann mit „+ Raum“ den ersten Raum.'),
  );
}

// --- Ansicht: Raumdetail ---------------------------------------------------------------

export async function renderRaum(container, raumId, neuLaden) {
  const projekt = await ladeProjekt();
  const raum = projekt.raeume.find((r) => r.id === raumId);
  if (!raum) {
    ersetzeKinder(container, 
      el('p', { class: 'meldung fehler' }, 'Diesen Raum gibt es nicht mehr.'),
      el('a', { class: 'knopf', href: '#raeume' }, '← Alle Räume'),
    );
    return;
  }

  const { ergebnis, hinweise, fehler } = rechne(projekt);
  const r = ergebnis?.raeume.find((x) => x.id === raum.id) ?? null;
  const eigeneFlaechen = projekt.flaechen.filter((f) => f.raumId === raum.id);
  const fremdeFlaechen = projekt.flaechen.filter((f) => f.raumId !== raum.id && f.angrenzend?.raumId === raum.id);
  const meldungen = meldungsTexte(projekt, ergebnis, hinweise).filter((m) => m.text.includes(`„${raum.name}“`));

  const zeilenTabelle = () => {
    const f = (a, b, c) => ({ zellen: [a, ...[b, c, (b + c) / 2].map(watt)] });
    const g = r.guenstig;
    const u = r.ungunstig;
    const zeilen = [
      f('Wände, Dächer, Böden (Hülle)', g.wand, u.wand),
      f('Fenster und Türen', g.oeffnungen, u.oeffnungen),
      f('Lüftung', g.lueftung, u.lueftung),
    ];
    if (g.aufheizung !== 0 || u.aufheizung !== 0) zeilen.push(f('Aufheizzuschlag', g.aufheizung, u.aufheizung));
    zeilen.push(f('Raum-zu-Raum (angerechnet)', g.raumZuRaumSumme, u.raumZuRaumSumme));
    if (raum.status === 'passiv') {
      zeilen.push({ klasse: 'summe', zellen: ['Netto-Verlust, wird auf liefernde Räume verteilt', ...[g.netto, u.netto, r.mittel.netto].map(watt)] });
    } else {
      if (g.zugeteilt !== 0 || u.zugeteilt !== 0) zeilen.push(f('Zugerechnet von passiven Räumen', g.zugeteilt, u.zugeteilt));
      zeilen.push({ klasse: 'summe', zellen: ['Heizlast', ...[g.heizlast, u.heizlast, r.mittel.heizlast].map(watt)] });
    }
    return tabelle(['', 'günstig', 'ungünstig', 'Mittel'], zeilen);
  };

  const anteile = r && raum.status === 'beheizt' ? passiveAnteile(projekt, ergebnis, raum.id) : [];

  ersetzeKinder(container, 
    el('a', { class: 'knopf', href: '#raeume' }, '← Alle Räume'),
    el(
      'div', { class: 'kopf abstand' },
      el('h2', {}, raum.name, el('span', { class: raum.status === 'beheizt' ? 'marke ruhig' : 'marke' }, label(STATI, raum.status))),
      el('button', { type: 'button', onClick: () => bearbeiteRaum(projekt, raum, neuLaden) }, 'Raum bearbeiten'),
    ),
    el('p', { class: 'zeile' }, [
      raum.geschoss,
      typeof raum.theta === 'number' ? `${zahlZuText(raum.theta)} °C` : null,
      Number.isFinite(raum.flaeche) ? `${formatZahl(raum.flaeche, 2)} m²` : null,
      Number.isFinite(raum.hoehe) ? `lichte Höhe ${formatZahl(raum.hoehe, 2)} m` : null,
      Number.isFinite(raumVolumen(raum)) ? `Volumen ${formatZahl(raumVolumen(raum), 1)} m³${raum.volumenManuell ? ' (manuell)' : ''}` : null,
      raum.luftwechsel ? `Luftwechsel ${zahlZuText(raum.luftwechsel.min)} bis ${zahlZuText(raum.luftwechsel.max)} 1/h` : 'Luftwechsel: Standard',
    ].filter(Boolean).join(' · ')),
    raum.notiz ? el('p', { class: 'zeile notiz' }, raum.notiz) : null,
    fehler ? el('p', { class: 'meldung fehler' }, `Rechenfehler: ${fehler}`) : null,
    ...meldungsBlock(meldungen),

    r
      ? el(
        'section', { class: 'karte abstand' },
        el('h3', {}, raum.status === 'passiv' ? 'Netto-Verlust' : 'Heizlast'),
        zeilenTabelle(),
        raumZuRaumListe(projekt, r, true),
        raum.status === 'passiv'
          ? el(
            'p', { class: 'zeile' },
            `Wärme liefern: ${(raum.waermeLieferanten ?? []).map((l) => `${raumName(projekt, l.raumId)} ${zahlZuText(l.prozent)} %`).join(', ') || 'keine Zuordnung'}`,
          )
          : null,
        anteile.length > 0
          ? el('p', { class: 'zeile' }, `Von passiven Räumen zugerechnet: ${anteile.map((a) => `${a.name} ${zahlZuText(a.prozent)} % (${wattBereich(a.von, a.bis)})`).join(', ')}`)
          : null,
      )
      : el('p', { class: 'zeile abstand' }, raum.status === 'unbeheizt' ? 'Unbeheizte Räume werden nicht gerechnet. Ihre Wirkung läuft über eine Zone.' : 'Dieser Raum wird nicht gerechnet.'),

    el(
      'div', { class: 'kopf abstand' },
      el('h3', {}, 'Raumflächen'),
      el('button', { type: 'button', class: 'primaer', onClick: () => bearbeiteFlaeche(projekt, raum, neueFlaeche(raum.id), neuLaden) }, '+ Fläche'),
    ),
    eigeneFlaechen.length > 0
      ? el('div', { class: 'karten' }, eigeneFlaechen.map((f) => flaechenKarte(projekt, raum, f, r, neuLaden)))
      : el('p', { class: 'leer' }, 'Noch keine Raumflächen. Mit „+ Fläche“ erfasst du Wände, Decke und Boden.'),

    fremdeFlaechen.length > 0
      ? el(
        'section', { class: 'abstand' },
        el('h3', {}, 'Flächen anderer Räume, die an diesen Raum grenzen'),
        el('ul', {}, fremdeFlaechen.map((f) => el(
          'li', {},
          `„${raumName(projekt, f.raumId)}“: ${flaechenBezeichnung(projekt, f)}, ${Number.isFinite(flaecheAusMassen(f)) ? `${formatZahl(flaecheAusMassen(f), 2)} m²` : 'Maße unvollständig'}`,
        ))),
      )
      : null,
  );
}
