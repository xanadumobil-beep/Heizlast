// Nötige Vorlauftemperatur je Raum und Bewertung der installierten Heizkörper.
// Reine Funktionen ohne Oberflächenbezug.
//
// Für jeden beheizten Raum wird die kleinste Vorlauftemperatur gesucht, bei der die Heizkörper mit
// Status "bleibt", "neu" oder "geplant" die Raumheizlast decken. Die Rücklauftemperatur ergibt sich
// aus der Vorlauftemperatur minus Spreizung, die Raumtemperatur ist die Soll-Temperatur des Raums.

import { heizkoerperLeistung, zaehltMit } from './radiator.js';

export const VORLAUF_MIN = 25;
export const VORLAUF_MAX = 75;
const RASTER_K = 0.5; // Schrittweite der Suche vor der Verfeinerung
const TOLERANZ_W = 1e-6;

// Summe der Leistungen bei einer Vorlauftemperatur.
// Fehlt bei einem Heizkörper die Leistung oder liegt die Vorlauftemperatur außerhalb seiner
// Datenblattwerte, ist die Summe unbestimmt (null), und der Heizkörper steht in der entsprechenden Liste.
export function installierteLeistung(heizkoerper, { tV, spreizung, ti }) {
  let summe = 0;
  const fehlend = [];
  const ausserhalb = [];
  for (const h of heizkoerper) {
    const l = heizkoerperLeistung(h, { tV, tR: tV - spreizung, ti });
    if (l.art === 'fehlt') fehlend.push(h.id);
    else if (l.art === 'ausserhalb') ausserhalb.push({ id: h.id, von: l.von, bis: l.bis });
    else summe += l.leistung;
  }
  return { summe: fehlend.length > 0 || ausserhalb.length > 0 ? null : summe, fehlend, ausserhalb };
}

// Kleinste Vorlauftemperatur im Bereich min bis max, bei der die Heizkörper die Heizlast decken.
// Ergebnis { status, ... }:
//   ok              vorlauf in °C; untergrenzeDatenblatt, wenn darunter keine Datenblattwerte vorliegen
//   kein_heizkoerper  kein Heizkörper mit Status bleibt/neu/geplant
//   leistung_fehlt  heizkoerperIds ohne Leistungsangabe, es gibt keine Vorlauftemperatur
//   nicht_deckbar   auch bei max nicht gedeckt, leistungBeiMax
//   unbestimmt      Datenblattwerte reichen nicht bis zur Deckung (keine Extrapolation)
// Die Suche läuft in Schritten von 0,5 K und verfeinert danach per Bisektion.
export function noetigeVorlauftemperatur({ heizkoerper, heizlast, spreizung, ti, min = VORLAUF_MIN, max = VORLAUF_MAX }) {
  const aktive = heizkoerper.filter(zaehltMit);
  if (aktive.length === 0) return { status: 'kein_heizkoerper' };

  const ohneLeistung = aktive.filter((h) => installierteLeistung([h], { tV: 60, spreizung, ti }).fehlend.length > 0);
  if (ohneLeistung.length > 0) return { status: 'leistung_fehlt', heizkoerperIds: ohneLeistung.map((h) => h.id) };

  const gesamt = (tV) => installierteLeistung(aktive, { tV, spreizung, ti });
  const gedeckt = (g) => g.summe !== null && g.summe >= heizlast - TOLERANZ_W;

  let vorher = null; // letzter Punkt mit bekannter Leistung, an dem die Heizlast noch nicht gedeckt war
  let unbekanntGesehen = false;
  let ersterBekannter = null;
  for (let tV = min; tV <= max + 1e-9; tV += RASTER_K) {
    const g = gesamt(tV);
    if (g.summe === null) {
      unbekanntGesehen = true;
      vorher = null;
      continue;
    }
    if (ersterBekannter === null) ersterBekannter = tV;
    if (gedeckt(g)) {
      if (vorher === null) {
        return { status: 'ok', vorlauf: tV, untergrenzeDatenblatt: tV > min + 1e-9 && ersterBekannter === tV };
      }
      let unten = vorher;
      let oben = tV;
      for (let i = 0; i < 50; i += 1) {
        const mitte = (unten + oben) / 2;
        if (gedeckt(gesamt(mitte))) oben = mitte;
        else unten = mitte;
      }
      return { status: 'ok', vorlauf: oben, untergrenzeDatenblatt: false };
    }
    vorher = tV;
  }
  if (unbekanntGesehen) return { status: 'unbestimmt', ausserhalb: gesamt(max).ausserhalb };
  return { status: 'nicht_deckbar', leistungBeiMax: gesamt(max).summe };
}

// Bewertet alle beheizten Räume bei einer gewählten Ziel-Vorlauftemperatur.
//
// raeume:     Ergebnisse des Rechenkerns für beheizte Räume:
//             [{ id, name, theta, guenstig: {...}, ungunstig: {...} }] mit heizlast, raumZuRaumSumme, zugeteilt
// heizkoerper: [{ raumId, ...Heizkörper }]
// Die nötige Vorlauftemperatur wird für die ungünstige und die günstige Heizlast bestimmt.
// Der Raum mit der höchsten nötigen Vorlauftemperatur der ungünstigen Rechnung ist der bestimmende Raum.
export function bewerteRaeume({ raeume, heizkoerper, spreizung, zielVorlauf }) {
  const zeilen = raeume.map((raum) => {
    const eigene = heizkoerper.filter((h) => h.raumId === raum.id);
    const aktive = eigene.filter(zaehltMit);
    const ti = raum.theta;
    const heizlast = raum.ungunstig.heizlast;

    const vorlauf = noetigeVorlauftemperatur({ heizkoerper: eigene, heizlast, spreizung, ti });
    const vorlaufGuenstig = noetigeVorlauftemperatur({ heizkoerper: eigene, heizlast: raum.guenstig.heizlast, spreizung, ti });
    const bei = installierteLeistung(aktive, { tV: zielVorlauf, spreizung, ti });
    const installiert = aktive.length > 0 ? bei.summe : null;

    const hinweise = [];
    if (vorlauf.status === 'kein_heizkoerper') hinweise.push({ art: 'kein_heizkoerper' });
    if (vorlauf.status === 'leistung_fehlt') hinweise.push({ art: 'leistung_fehlt', heizkoerperIds: vorlauf.heizkoerperIds });
    if (vorlauf.status === 'nicht_deckbar') hinweise.push({ art: 'nicht_deckbar', leistungBeiMax: vorlauf.leistungBeiMax });
    if (vorlauf.status === 'unbestimmt') hinweise.push({ art: 'ausserhalb_datenblatt', einzelne: vorlauf.ausserhalb });
    if (vorlauf.status === 'ok' && vorlauf.untergrenzeDatenblatt) {
      hinweise.push({ art: 'untergrenze_datenblatt', vorlauf: vorlauf.vorlauf });
    }
    if (bei.ausserhalb.length > 0 && aktive.length > 0 && bei.fehlend.length === 0) {
      hinweise.push({ art: 'ausserhalb_datenblatt_ziel', einzelne: bei.ausserhalb });
    }
    const alte = aktive.filter((h) => h.ventil === 'alt').map((h) => h.id);
    if (alte.length > 0) hinweise.push({ art: 'altes_ventil', heizkoerperIds: alte });
    const abweichend = aktive.filter((h) => h.bauart === 'wp' && istZahl(h.kennlinieRaumtemperatur) && h.kennlinieRaumtemperatur !== ti);
    if (abweichend.length > 0) {
      hinweise.push({
        art: 'bezugstemperatur_abweichend', heizkoerperIds: abweichend.map((h) => h.id),
        bezug: abweichend[0].kennlinieRaumtemperatur, raumTemperatur: ti,
      });
    }

    return {
      raumId: raum.id,
      name: raum.name,
      theta: ti,
      heizlast,
      heizlastGuenstig: raum.guenstig.heizlast,
      // Herkunft der Raumheizlast: Raum-zu-Raum-Verluste und zugerechnete Anteile passiver Räume
      davonRaumZuRaum: raum.ungunstig.raumZuRaumSumme,
      davonPassiv: raum.ungunstig.zugeteilt,
      installiert,
      deckung: installiert !== null && heizlast > 0 ? (installiert / heizlast) * 100 : null,
      differenz: installiert !== null ? installiert - heizlast : null,
      vorlauf,
      vorlaufGuenstig,
      hinweise,
      bestimmend: false,
    };
  });

  // Bestimmender Raum: höchste nötige Vorlauftemperatur. Ein nicht deckbarer Raum braucht mehr als das
  // Maximum und geht vor, mit dem größten Fehlbetrag bei der Maximaltemperatur zuerst.
  const nichtDeckbar = zeilen.filter((z) => z.vorlauf.status === 'nicht_deckbar');
  const deckbar = zeilen.filter((z) => z.vorlauf.status === 'ok');
  let bestimmend = null;
  if (nichtDeckbar.length > 0) {
    bestimmend = nichtDeckbar.reduce((a, b) => (b.heizlast - b.vorlauf.leistungBeiMax > a.heizlast - a.vorlauf.leistungBeiMax ? b : a));
  } else if (deckbar.length > 0) {
    bestimmend = deckbar.reduce((a, b) => (b.vorlauf.vorlauf > a.vorlauf.vorlauf ? b : a));
  }
  if (bestimmend) bestimmend.bestimmend = true;

  // Räume, für die keine Vorlauftemperatur bestimmt werden konnte: die Rangfolge ist dort unsicher.
  const unsicher = zeilen.filter((z) => !['ok', 'nicht_deckbar'].includes(z.vorlauf.status)).map((z) => z.raumId);
  return { zeilen, bestimmendId: bestimmend?.raumId ?? null, unsicher };
}

function istZahl(x) {
  return typeof x === 'number' && Number.isFinite(x);
}
