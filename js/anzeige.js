// Reine Anzeigehilfen ohne Oberflächenbezug: Zahlenformate, Texte zu Flächen und Räumen, Meldungen aus dem
// Rechenkern in Klartext und die Auswertung des Verbrauchsabgleichs. Bildschirm und Bericht nutzen dasselbe.

import { formatZahl, formatBereich, zahlZuText } from './engine/format.js';
import { flaecheAusMassen } from './modell.js';
import { berechneVerbrauch, vergleiche } from './engine/verbrauch.js';
import { hatFehler, validiereVerbrauch } from './validate.js';
import { sortierteKennlinie } from './engine/radiator.js';
import { normleistungVon } from './modell.js';
import { VORLAUF_MAX } from './engine/vorlauf.js';

export const watt = (x) => `${formatZahl(x, 0)} W`;
export const wattBereich = (a, b) => `${formatBereich(a, b, 0)} W`;
export const wattBereichVon = (b) => wattBereich(b.min, b.max);
export const FALL_NAME = { guenstig: 'günstig', ungunstig: 'ungünstig' };

export const raumName = (projekt, id) => projekt.raeume.find((r) => r.id === id)?.name ?? 'nicht mehr vorhandener Raum';

export function flaechenBezeichnung(projekt, flaeche) {
  const bauteil = projekt.bauteile.find((b) => b.id === flaeche.bauteilId);
  return flaeche.name || bauteil?.name || 'Fläche';
}

export function angrenzendText(projekt, angrenzend) {
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

export function massText(m) {
  const flaeche = flaecheAusMassen(m);
  if (m.modus === 'flaeche') return `${formatZahl(flaeche, 2)} m²`;
  return `${formatZahl(m.laenge, 2)} m × ${formatZahl(m.hoehe, 2)} m = ${formatZahl(flaeche, 2)} m²`;
}

// Erklärt, warum ein Raum-zu-Raum-Verlust nicht angerechnet wird.
export function grundText(projekt, eintrag) {
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
export function meldungsTexte(projekt, ergebnis, hinweise) {
  const texte = [];
  for (const w of ergebnis?.warnungen ?? []) {
    if (w.art === 'gegenprobe') {
      const betrag = formatZahl(Math.abs(w.differenz), 1);
      texte.push({
        stufe: 'fehler', art: w.art, raumId: null,
        text: `Gegenprobe (${FALL_NAME[w.fall]}): Die Raumheizlasten weichen um ${betrag} W von der Gebäudesumme ab, `
          + `${w.differenz > 0 ? `es fehlen ${betrag} W in den Raumheizlasten` : `${betrag} W sind doppelt gezählt`}. `
          + 'Meist stimmt die Verteilung eines passiven Raums nicht auf 100 %.',
      });
    } else if (w.art === 'passiv_verteilung') {
      texte.push({
        stufe: 'warnung', art: w.art, raumId: w.raumId,
        text: `Passiver Raum „${raumName(projekt, w.raumId)}“: Die Wärmelieferanten ergeben ${formatZahl(w.summe, 1)} % statt 100 %.`,
      });
    } else if (w.art === 'lieferant_kein_beheizter_raum') {
      texte.push({
        stufe: 'warnung', art: w.art, raumId: w.raumId,
        text: `Passiver Raum „${raumName(projekt, w.raumId)}“: „${raumName(projekt, w.lieferantId)}“ ist kein beheizter Raum und liefert keine Wärme.`,
      });
    } else if (w.art === 'passiv_ohne_anteil') {
      texte.push({
        stufe: 'warnung', art: w.art, raumId: w.raumId, proRaum: true,
        text: `Grenzt an passiven Raum „${raumName(projekt, w.passivId)}“ ohne Wärmeanteil, Raumheizlast möglicherweise zu niedrig.`,
      });
    } else if (w.art === 'gegenraum_unbrauchbar') {
      texte.push({
        stufe: 'warnung', art: w.art, raumId: w.raumId,
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
    if (nachricht) texte.push({ stufe: 'warnung', art: h.art, raumId: h.raumId, text: nachricht });
  }
  return texte;
}


// --- Verbrauchsabgleich ------------------------------------------------------------------

export const mitVorzeichen = (x, stellen = 1) => `${x > 0 ? '+' : ''}${formatZahl(x, stellen)} %`.replace('-', '−');

export const FEHLER_TEXT = {
  angaben_fehlen: 'Es fehlen Angaben.',
  holz_angaben_fehlen: 'Für das Holz fehlen Heizwert oder Wirkungsgrad.',
  nicht_heizung_zu_gross: 'Der Anteil nicht für Heizung ist größer als der Gasverbrauch.',
  monat_unvollstaendig: 'Ein gewählter Heizmonat ist unvollständig.',
  keine_heizmonate: 'Es ist kein Heizmonat gewählt.',
  gradtage_nicht_positiv: 'Die umgerechnete Gradtagzahl ist nicht positiv.',
};

// Berechnete Gebäudeheizlast als Bandbreite von der günstigen bis zur ungünstigen Rechnung.
export function berechneteBandbreite(ergebnis) {
  if (!ergebnis || ergebnis.raeume.length === 0) return null;
  const g = ergebnis.gebaeude.guenstig.summe;
  const u = ergebnis.gebaeude.ungunstig.summe;
  return { min: Math.min(g, u), max: Math.max(g, u) };
}

export function engineEingabe(doc, projekt) {
  return {
    gasKwh: doc.gasKwh,
    nichtFuerHeizungKwh: doc.nichtFuerHeizungKwh,
    kesselNutzungsgrad: doc.kesselNutzungsgrad,
    holzRm: doc.holzRm,
    heizwertRm: doc.heizwertRm,
    ofenWirkungsgrad: doc.ofenWirkungsgrad,
    monate: doc.monate ?? [],
    innentemperaturIst: doc.innentemperaturIst,
    innentemperaturSoll: doc.innentemperaturSoll,
    normAussentemperatur: projekt.einstellungen.thetaAussen,
  };
}

// Ein Abgleich, ausgewertet: { meldungen, eingabe, ergebnis, vergleich } (ergebnis nur ohne Fehler).
export function auswerten(doc, projekt, berechnet) {
  const meldungen = validiereVerbrauch(doc);
  const eingabe = engineEingabe(doc, projekt);
  if (hatFehler(meldungen)) return { meldungen, eingabe, ergebnis: null, vergleich: null };
  const ergebnis = berechneVerbrauch(eingabe);
  const vergleich = ergebnis.status === 'ok' ? vergleiche(berechnet, ergebnis.heizlast) : null;
  return { meldungen, eingabe, ergebnis, vergleich };
}

export function abweichungsText(vergleich) {
  if (!vergleich || vergleich.abweichungProzent === null) return null;
  return `Abweichung ${mitVorzeichen(vergleich.abweichungProzent)} (Mittelwert Verbrauch gegenüber Berechnung)`;
}


// --- Heizkörper ------------------------------------------------------------------------

// Fehlt die Leistung? Wärmepumpen-Heizkörper brauchen zwei Wertepaare, die übrigen eine Normleistung.
export function leistungFehlt(h) {
  return h.bauart === 'wp' ? sortierteKennlinie(h.kennlinie).length < 2 : normleistungVon(h) === null;
}

export function heizkoerperLeistungsText(h) {
  if (leistungFehlt(h)) return 'Leistung fehlt';
  if (h.bauart === 'wp') {
    const paare = sortierteKennlinie(h.kennlinie);
    return `Kennlinie: ${paare.length} Wertepaare, ${zahlZuText(paare[0].vorlauf)} bis ${zahlZuText(paare[paare.length - 1].vorlauf)} °C Vorlauf, `
      + `für ${zahlZuText(h.kennlinieRaumtemperatur)} °C Raumtemperatur`;
  }
  const phi = normleistungVon(h);
  const ausGliedern = !(h.normleistung > 0);
  return `${formatZahl(phi, 0)} W bei ${zahlZuText(h.normVorlauf)}/${zahlZuText(h.normRuecklauf)}/${zahlZuText(h.normRaum)} °C`
    + `${ausGliedern ? ` (${h.gliederzahl} Glieder × ${formatZahl(h.leistungJeGlied, 0)} W)` : ''}`
    + `, n = ${typeof h.exponent === 'number' ? zahlZuText(h.exponent) : 'Standard'}`;
}

export function heizkoerperMasseText(h) {
  const teile = [['H', h.bauhoehe], ['L', h.baulaenge], ['T', h.bautiefe]].filter(([, w]) => typeof w === 'number');
  const text = teile.map(([k, w]) => `${k} ${zahlZuText(w)}`).join(' × ');
  return [text ? `${text} mm` : null, typeof h.nabenabstand === 'number' ? `Nabenabstand ${zahlZuText(h.nabenabstand)} mm` : null]
    .filter(Boolean).join(' · ');
}


// --- Vorlauftemperatur ---------------------------------------------------------------

// Nötige Vorlauftemperatur als Text für die Tabelle.
export function vorlaufText(v) {
  switch (v.status) {
    case 'ok': return `${v.untergrenzeDatenblatt ? '≤ ' : ''}${formatZahl(v.vorlauf, 1)} °C`;
    case 'nicht_deckbar': return `nicht deckbar (über ${VORLAUF_MAX} °C)`;
    case 'leistung_fehlt': return 'Leistung fehlt';
    case 'kein_heizkoerper': return 'kein Heizkörper';
    default: return 'Datenblatt reicht nicht';
  }
}

export function hinweisText(h, ziel) {
  switch (h.art) {
    case 'kein_heizkoerper': return 'Kein Heizkörper mit Status „Bleibt“, „Neu“ oder „Geplant“ erfasst.';
    case 'leistung_fehlt': return `Leistung fehlt bei ${h.heizkoerperIds.length} Heizkörper${h.heizkoerperIds.length === 1 ? '' : 'n'}: für diesen Raum wird keine Vorlauftemperatur berechnet.`;
    case 'nicht_deckbar': return `Auch bei ${VORLAUF_MAX} °C nicht gedeckt, die Heizkörper leisten dort ${watt(h.leistungBeiMax)}.`;
    case 'ausserhalb_datenblatt': return 'Die Datenblattwerte eines Wärmepumpen-Heizkörpers reichen nicht, um die Heizlast zu decken. Es wird nicht extrapoliert.';
    case 'ausserhalb_datenblatt_ziel': return `Bei ${ziel} °C liegt ein Wärmepumpen-Heizkörper außerhalb seiner Datenblattwerte (${zahlZuText(h.einzelne[0].von)} bis ${zahlZuText(h.einzelne[0].bis)} °C): keine Leistung ausgewiesen.`;
    case 'untergrenze_datenblatt': return `Die Datenblattwerte beginnen bei ${formatZahl(h.vorlauf, 1)} °C. Die nötige Vorlauftemperatur liegt höchstens dort.`;
    case 'altes_ventil': return 'Altes Ventil: kein hydraulischer Abgleich möglich (nur Hinweis, die Leistung ändert sich nicht).';
    case 'bezugstemperatur_abweichend': return `Das Datenblatt gilt für ${zahlZuText(h.bezug)} °C Raumtemperatur, der Raum hat ${zahlZuText(h.raumTemperatur)} °C. Die Werte sind unverändert übernommen.`;
    default: return '';
  }
}

