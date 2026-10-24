// Plan: schematische Darstellung der Raumbeziehungen und Vollständigkeitsprüfung. Reine Funktionen ohne Oberfläche.
//
// Aus den Projektdaten entstehen Kästen (Räume), Symbole (Außenluft und Zonen) und Linien (eine je Raumfläche).
// Die Zeichnung selbst (Koordinaten) steht in planlayout.js, das SVG in planzeichnung.js.
//
// Positionen: Ein Raum kann `plan: { x, y }` tragen. Das ist der Mittelpunkt des Kastens in Prozent der Breite
// und Höhe der Zeichenfläche seines Geschosses (0 bis 100, Ursprung links oben). Die Angabe in Prozent gilt später
// auch relativ zu einem Hintergrundbild (fotografierter Bauplan): die Zeichenfläche bekommt dann dessen Seitenverhältnis.
// Räume ohne Position erhalten eine automatische Rasteranordnung (siehe planlayout.js).

import { formatZahl, zahlZuText } from './engine/format.js';
import { flaecheAusMassen, nettoFlaeche } from './modell.js';
import { flaechenBezeichnung, angrenzendText, wattBereich, leistungFehlt } from './anzeige.js';
import { label, STATI } from './schemas.js';

// Anzeigereihenfolge von oben nach unten. Unbekannte Geschosse stehen danach.
export const GESCHOSS_ORDNUNG = ['DG', 'OG', 'EG', 'Keller'];
const EBENE = { Keller: 0, EG: 1, OG: 2, DG: 3 };
export const ZEICHEN = { ok: '✓', warnung: '⚠', fehler: '✗' };
export const FLAECHEN_TOLERANZ = 0.1; // mehr als 10 % Abweichung von der Raumfläche wird gemeldet

const ebeneVon = (geschoss) => EBENE[geschoss] ?? null;
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const z = zahlZuText;

export function geschossReihenfolge(geschosse) {
  const vorhanden = [...new Set(geschosse)];
  const bekannt = GESCHOSS_ORDNUNG.filter((g) => vorhanden.includes(g));
  return [...bekannt, ...vorhanden.filter((g) => !GESCHOSS_ORDNUNG.includes(g)).sort()];
}

const nachGeschossUndName = (a, b) => {
  const ordnung = geschossReihenfolge([a.geschoss, b.geschoss]);
  return ordnung.indexOf(a.geschoss) - ordnung.indexOf(b.geschoss) || (a.name ?? '').localeCompare(b.name ?? '', 'de');
};

// --- Vollständigkeitsprüfung -------------------------------------------------------------------

const bauteilArt = (projekt, flaeche) => projekt.bauteile.find((b) => b.id === flaeche.bauteilId)?.art ?? null;

function gegenEbene(projekt, flaeche) {
  if (flaeche.angrenzend?.art !== 'raum') return null;
  return ebeneVon(projekt.raeume.find((r) => r.id === flaeche.angrenzend.raumId)?.geschoss);
}

// Boden: Kellerdecke, Bodenplatte oder eine Decke zu einem Raum in einem tieferen Geschoss.
function istBoden(projekt, raum, flaeche) {
  const art = bauteilArt(projekt, flaeche);
  if (art === 'kellerdecke' || art === 'bodenplatte') return true;
  const unten = gegenEbene(projekt, flaeche);
  const eigene = ebeneVon(raum.geschoss);
  return art === 'innendecke' && unten !== null && eigene !== null && unten < eigene;
}

// Dach: Dach oder eine sonstige Decke, die nicht der Boden ist.
const istDach = (projekt, raum, flaeche) => {
  const art = bauteilArt(projekt, flaeche);
  return art === 'dach' || (art === 'innendecke' && !istBoden(projekt, raum, flaeche));
};

const punkt = (id, stufe, titel, text) => ({ id, stufe, titel, text });
const schlechtester = (stufen) => (stufen.includes('fehler') ? 'fehler' : stufen.includes('warnung') ? 'warnung' : 'ok');

// Vergleicht die Summe einer Flächengruppe (Boden oder Dach) mit der Raumfläche.
function flaechenSumme(id, titel, name, raum, flaechen) {
  const werte = flaechen.map(flaecheAusMassen);
  if (werte.some((w) => !Number.isFinite(w))) {
    return punkt(id, 'warnung', titel, `${name}: Maße unvollständig, die Fläche lässt sich nicht prüfen.`);
  }
  if (!istZahl(raum.flaeche) || !(raum.flaeche > 0)) {
    return punkt(id, 'warnung', titel, 'Die Raumfläche fehlt, ein Vergleich ist nicht möglich.');
  }
  const summe = werte.reduce((a, b) => a + b, 0);
  const abweichung = (summe - raum.flaeche) / raum.flaeche;
  const prozent = formatZahl(Math.abs(abweichung) * 100, 1);
  if (Math.abs(abweichung) > FLAECHEN_TOLERANZ) {
    return punkt(
      id, 'warnung', titel,
      `${name} ${formatZahl(summe, 2)} m² ist ${prozent} % ${abweichung < 0 ? 'kleiner' : 'größer'} als die Raumfläche ${formatZahl(raum.flaeche, 2)} m².`,
    );
  }
  return punkt(id, 'ok', titel, `${name} ${formatZahl(summe, 2)} m², Raumfläche ${formatZahl(raum.flaeche, 2)} m² (Abweichung ${prozent} %).`);
}

function pruefeRaum(projekt, raum) {
  const grunddaten = { raumId: raum.id, name: raum.name, geschoss: raum.geschoss, status: raum.status };
  if (raum.status === 'unbeheizt') {
    return { ...grunddaten, geprueft: false, punkte: [], gesamt: 'ok' };
  }
  const flaechen = projekt.flaechen.filter((f) => f.raumId === raum.id);
  const punkte = [];
  const eg = raum.geschoss !== 'Keller';

  if (eg) {
    const dach = flaechen.filter((f) => istDach(projekt, raum, f));
    const boden = flaechen.filter((f) => istBoden(projekt, raum, f));
    punkte.push(dach.length > 0
      ? punkt('dach', 'ok', 'Dach', `${dach.length === 1 ? 'Eine Fläche' : `${dach.length} Flächen`} als Dach oder Decke erfasst.`)
      : punkt('dach', 'fehler', 'Dach', 'Kein Dach (Bauteilart Dach oder Decke) erfasst.'));
    punkte.push(boden.length > 0
      ? punkt('boden', 'ok', 'Boden', `${boden.length === 1 ? 'Eine Fläche' : `${boden.length} Flächen`} als Boden erfasst (Kellerdecke, Bodenplatte oder Decke zu einem Raum darunter).`)
      : punkt('boden', 'fehler', 'Boden', 'Kein Boden (Kellerdecke, Bodenplatte oder Decke zu einem Raum darunter) erfasst.'));
    if (dach.length > 0) punkte.push(flaechenSumme('dachflaeche', 'Dachfläche', 'Dachfläche', raum, dach));
    if (boden.length > 0) punkte.push(flaechenSumme('bodenflaeche', 'Bodenfläche', 'Bodenfläche', raum, boden));
  } else {
    const platte = flaechen.filter((f) => bauteilArt(projekt, f) === 'bodenplatte');
    punkte.push(platte.length > 0
      ? punkt('boden', 'ok', 'Bodenplatte', `${platte.length === 1 ? 'Eine Fläche' : `${platte.length} Flächen`} als Bodenplatte erfasst.`)
      : punkt('boden', 'fehler', 'Bodenplatte', 'Keine Bodenplatte erfasst.'));
    if (platte.length > 0) punkte.push(flaechenSumme('bodenflaeche', 'Bodenfläche', 'Bodenplatte', raum, platte));
  }

  const nachAussen = flaechen.filter((f) => f.angrenzend?.art === 'aussen' || f.angrenzend?.art === 'zone');
  punkte.push(nachAussen.length > 0
    ? punkt('huelle', 'ok', 'Außen-, Nachbar- oder Zonenfläche', `${nachAussen.length} Fläche${nachAussen.length === 1 ? '' : 'n'} an Außenluft oder Zonen.`)
    : punkt('huelle', 'fehler', 'Außen-, Nachbar- oder Zonenfläche', 'Keine Fläche an Außenluft, Nachbar oder Zone erfasst.'));

  const unvollstaendig = flaechen.filter((f) => !Number.isFinite(flaecheAusMassen(f)));
  punkte.push(unvollstaendig.length === 0
    ? punkt('masse', 'ok', 'Maße der Raumflächen', 'Alle Raumflächen haben vollständige Maße.')
    : punkt('masse', 'fehler', 'Maße der Raumflächen', `${unvollstaendig.length} Fläche${unvollstaendig.length === 1 ? '' : 'n'} ohne vollständige Maße: ${unvollstaendig.map((f) => `„${flaechenBezeichnung(projekt, f)}“`).join(', ')}.`));

  if (raum.status === 'beheizt') {
    const aktiv = projekt.heizkoerper.filter((h) => h.raumId === raum.id && h.status !== 'entfaellt');
    const ohneLeistung = aktiv.filter(leistungFehlt);
    if (aktiv.length === 0) {
      punkte.push(punkt('heizkoerper', 'fehler', 'Heizkörper', 'Kein Heizkörper mit Status Bleibt, Neu oder Geplant erfasst.'));
    } else if (ohneLeistung.length > 0) {
      punkte.push(punkt('heizkoerper', 'warnung', 'Heizkörper', `Leistung fehlt bei ${ohneLeistung.length} von ${aktiv.length} Heizkörper${aktiv.length === 1 ? '' : 'n'}.`));
    } else {
      punkte.push(punkt('heizkoerper', 'ok', 'Heizkörper', `${aktiv.length} Heizkörper mit vollständiger Leistung.`));
    }
  } else {
    const summe = (raum.waermeLieferanten ?? []).reduce((s, l) => s + (l.prozent ?? 0), 0);
    punkte.push(Math.abs(summe - 100) <= 0.01
      ? punkt('lieferanten', 'ok', 'Wärmelieferanten', 'Die Anteile ergeben 100 %.')
      : punkt('lieferanten', 'warnung', 'Wärmelieferanten', `Die Anteile ergeben ${formatZahl(summe, 1)} % statt 100 %.`));
  }

  return { ...grunddaten, geprueft: true, punkte, gesamt: schlechtester(punkte.map((p) => p.stufe)) };
}

// Ergebnis je Raum: { raumId, name, geschoss, status, geprueft, punkte: [{ id, stufe, titel, text }], gesamt }
export function pruefeVollstaendigkeit(projekt) {
  return [...projekt.raeume].sort(nachGeschossUndName).map((raum) => pruefeRaum(projekt, raum));
}

// --- Plan-Modell -------------------------------------------------------------------------------

const ZONEN_REIHENFOLGE = ['nachbar', 'unbeheizt', 'erdreich'];

function zonenSymbole(projekt) {
  const sortiert = [...projekt.zonen].sort((a, b) => {
    const rang = (zone) => { const i = ZONEN_REIHENFOLGE.indexOf(zone.art); return i < 0 ? ZONEN_REIHENFOLGE.length : i; };
    return rang(a) - rang(b) || a.name.localeCompare(b.name, 'de');
  });
  return [
    { id: 'aussen', art: 'aussen', name: 'Außenluft', temperatur: `${z(projekt.einstellungen.thetaAussen)} °C` },
    ...sortiert.map((zone) => ({
      id: `zone:${zone.id}`,
      art: zone.art,
      name: zone.name,
      temperatur: zone.temperatur.min === zone.temperatur.max
        ? `${z(zone.temperatur.min)} °C`
        : `${z(zone.temperatur.min)} bis ${z(zone.temperatur.max)} °C`,
    })),
  ];
}

const verlustVon = (x) => (x ? x.wand + x.oeffnungen + x.raumZuRaum : null);

function verlustBereich(ergebnis, raumId, flaecheId) {
  const raum = ergebnis?.raeume.find((r) => r.id === raumId);
  const g = raum?.guenstig.flaechen.find((f) => f.id === flaecheId);
  const u = raum?.ungunstig.flaechen.find((f) => f.id === flaecheId);
  return g && u ? { min: Math.min(verlustVon(g), verlustVon(u)), max: Math.max(verlustVon(g), verlustVon(u)) } : null;
}

// Jede Raumfläche ergibt eine Linie. Wände zwischen zwei Räumen werden nur einmal gezeichnet: aus dem wärmeren
// Raum, weil nur dort der Verlust angerechnet wird. Steht die Wand nur auf einer Seite, wird sie markiert.
function baueLinien(projekt, ergebnis, raumKarte) {
  const linien = [];
  const wandPaare = new Map();

  const zielDerFlaeche = (f) => {
    const ang = f.angrenzend;
    if (!ang) return null;
    if (ang.art === 'aussen') return { art: 'aussen', id: 'aussen' };
    if (ang.art === 'zone') return projekt.zonen.some((zone) => zone.id === ang.zoneId) ? { art: 'zone', id: `zone:${ang.zoneId}` } : null;
    return raumKarte.has(ang.raumId) ? { art: 'raum', id: ang.raumId } : null;
  };

  const neueLinie = (f, ziel, extra = {}) => {
    const raum = raumKarte.get(f.raumId);
    const bauteil = projekt.bauteile.find((b) => b.id === f.bauteilId);
    const brutto = flaecheAusMassen(f);
    const zone = ziel.art === 'zone' ? projekt.zonen.find((zz) => `zone:${zz.id}` === ziel.id) : null;
    const farbe = ziel.art === 'zone' ? zone.art : ziel.art;
    const marker = [];
    if (!Number.isFinite(brutto)) marker.push({ art: 'masse', text: 'Länge, Höhe oder Fläche fehlt: die Fläche wird nicht gerechnet.' });
    return {
      id: `l-${f.id}`,
      flaecheId: f.id,
      raumId: f.raumId,
      zielId: ziel.id,
      zielArt: ziel.art,
      farbe,
      flaeche: Number.isFinite(brutto) ? brutto : null,
      netto: Number.isFinite(brutto) ? nettoFlaeche(f) : null,
      bauteilName: bauteil?.name ?? 'Bauteil fehlt im Katalog',
      bezeichnung: flaechenBezeichnung(projekt, f),
      raumName: raum.name,
      angrenzendText: angrenzendText(projekt, f.angrenzend),
      u: bauteil?.u ?? null,
      verlust: verlustBereich(ergebnis, f.raumId, f.id),
      pfeil: null,
      marker,
      ...extra,
    };
  };

  for (const f of projekt.flaechen) {
    if (!raumKarte.has(f.raumId)) continue;
    const ziel = zielDerFlaeche(f);
    if (!ziel) continue;
    if (ziel.art !== 'raum') {
      linien.push(neueLinie(f, ziel));
      continue;
    }
    const schluessel = [f.raumId, ziel.id].sort().join('|');
    if (!wandPaare.has(schluessel)) wandPaare.set(schluessel, { ids: schluessel.split('|'), flaechen: [] });
    wandPaare.get(schluessel).flaechen.push({ f, ziel });
  }

  for (const paar of wandPaare.values()) {
    const [idA, idB] = paar.ids;
    const vonA = paar.flaechen.filter(({ f }) => f.raumId === idA);
    const vonB = paar.flaechen.filter(({ f }) => f.raumId === idB);
    const a = raumKarte.get(idA);
    const b = raumKarte.get(idB);
    const beideBeheizt = a.status === 'beheizt' && b.status === 'beheizt';
    const waermer = beideBeheizt && a.theta !== b.theta ? (a.theta > b.theta ? a : b) : null;

    let gewaehlt;
    if (vonA.length > 0 && vonB.length > 0) {
      gewaehlt = waermer ? (waermer.id === idA ? vonA : vonB) : vonA;
    } else {
      gewaehlt = vonA.length > 0 ? vonA : vonB;
    }

    for (const { f, ziel } of gewaehlt) {
      const eigentuemer = raumKarte.get(f.raumId);
      const nachbar = raumKarte.get(ziel.id);
      const linie = neueLinie(f, ziel);
      linie.zielName = nachbar.name;
      const warm = beideBeheizt && eigentuemer.theta > nachbar.theta;
      if (warm) {
        linie.pfeil = { von: eigentuemer.id, nach: nachbar.id };
        linie.waermeText = `Wärme wird vom wärmeren Raum „${eigentuemer.name}“ (${z(eigentuemer.theta)} °C) zum kälteren Raum „${nachbar.name}“ (${z(nachbar.theta)} °C) angerechnet.`;
      } else if (eigentuemer.status === 'passiv' || nachbar.status === 'passiv') {
        linie.waermeText = 'Grenze zu einem passiven Raum: kein Raum-zu-Raum-Verlust, der Verlust des passiven Raums wird über seine Wärmelieferanten zugerechnet.';
      } else if (beideBeheizt && eigentuemer.theta === nachbar.theta) {
        linie.waermeText = 'Gleiche Temperatur in beiden Räumen: kein Wärmestrom.';
      } else if (beideBeheizt) {
        linie.waermeText = `„${nachbar.name}“ ist wärmer: keine Gutschrift, der Verlust fällt im wärmeren Raum an.`;
      }
      const einseitig = vonA.length === 0 || vonB.length === 0;
      if (einseitig) {
        linie.marker.push({
          art: 'einseitig',
          text: warm
            ? `Die Gegenseite fehlt: „${nachbar.name}“ führt keine Fläche zu „${eigentuemer.name}“. Der Verlust wird trotzdem angerechnet.`
            : `Die Wand steht nur in „${eigentuemer.name}“, nicht in „${nachbar.name}“.${beideBeheizt && eigentuemer.theta < nachbar.theta
              ? ` „${nachbar.name}“ ist wärmer, sein Verlust an diese Wand wird deshalb nicht angerechnet.` : ''}`,
        });
      }
      linie.gegenseiteEingetragen = !einseitig;
      linien.push(linie);
    }
  }
  return linien;
}

// Plan-Modell. projekt: wie aus ladeProjekt(); ergebnis: Ergebnis von rechne() oder null.
// Rückgabe: { geschosse: [{ name, kaesten }], symbole, linien, passivLinien, auffaelligkeiten, pruefung }
export function baueplan(projekt, ergebnis) {
  const raumKarte = new Map(projekt.raeume.map((r) => [r.id, r]));
  const pruefung = pruefeVollstaendigkeit(projekt);
  const gesamtVon = new Map(pruefung.map((p) => [p.raumId, p]));
  const auffaelligkeiten = [];
  const markiereRaum = (raumId, art, text, stufe = 'warnung') => auffaelligkeiten.push({ art, stufe, raumId, text });

  const linien = baueLinien(projekt, ergebnis, raumKarte);

  // Beheizter Raum neben einem passiven Raum ohne Wärmeanteil.
  const paare = new Set();
  for (const f of projekt.flaechen) {
    if (f.angrenzend?.art !== 'raum') continue;
    const a = raumKarte.get(f.raumId);
    const b = raumKarte.get(f.angrenzend.raumId);
    if (!a || !b) continue;
    const [heiss, passiv] = a.status === 'beheizt' && b.status === 'passiv' ? [a, b] : b.status === 'beheizt' && a.status === 'passiv' ? [b, a] : [null, null];
    if (heiss) paare.add(`${heiss.id}|${passiv.id}`);
  }
  for (const eintrag of paare) {
    const [heissId, passivId] = eintrag.split('|');
    const anteil = raumKarte.get(passivId).waermeLieferanten?.find((l) => l.raumId === heissId)?.prozent ?? 0;
    if (anteil > 0) continue;
    const text = `Grenzt an den passiven Raum „${raumKarte.get(passivId).name}“, ist aber kein Wärmelieferant: Die Raumheizlast ist möglicherweise zu niedrig.`;
    markiereRaum(heissId, 'passiv_ohne_anteil', text);
    for (const l of linien) {
      if (l.zielArt === 'raum' && [l.raumId, l.zielId].sort().join('|') === [heissId, passivId].sort().join('|')) {
        l.marker.push({ art: 'passiv_ohne_anteil', text });
      }
    }
  }

  for (const l of linien) {
    for (const m of l.marker) {
      if (m.art === 'passiv_ohne_anteil') continue; // steht schon am beheizten Raum
      markiereRaum(l.raumId, m.art, `Fläche „${l.bezeichnung}“: ${m.text}`);
      if (m.art === 'einseitig' && l.zielArt === 'raum') markiereRaum(l.zielId, m.art, `Wand zu „${l.raumName}“: nur dort eingetragen.`);
    }
  }

  // Heizkörper ohne Leistung und Verteilung passiver Räume.
  for (const raum of projekt.raeume) {
    if (raum.status === 'beheizt') {
      const aktiv = projekt.heizkoerper.filter((h) => h.raumId === raum.id && h.status !== 'entfaellt');
      const ohne = aktiv.filter(leistungFehlt).length;
      if (ohne > 0) markiereRaum(raum.id, 'leistung_fehlt', `Heizkörper ohne Leistung: ${ohne}.`);
    }
    if (raum.status === 'passiv') {
      const summe = (raum.waermeLieferanten ?? []).reduce((s, l) => s + (l.prozent ?? 0), 0);
      if (Math.abs(summe - 100) > 0.01) markiereRaum(raum.id, 'passiv_verteilung', `Die Wärmeanteile ergeben ${formatZahl(summe, 1)} % statt 100 %.`);
    }
  }

  // Doppelte Meldungen (zum Beispiel beide Seiten) entfernen.
  const gesehen = new Set();
  const eindeutig = auffaelligkeiten.filter((a) => { const k = `${a.raumId}|${a.art}|${a.text}`; if (gesehen.has(k)) return false; gesehen.add(k); return true; });

  // Räume, die über eine Wand oder als Wärmelieferant mit diesem Raum verbunden sind (für die Startanordnung).
  const verbundenMit = (id) => [...new Set([
    ...linien.filter((l) => l.zielArt === 'raum' && l.raumId === id).map((l) => l.zielId),
    ...linien.filter((l) => l.zielArt === 'raum' && l.zielId === id).map((l) => l.raumId),
    ...(raumKarte.get(id).waermeLieferanten ?? []).map((l) => l.raumId),
    ...projekt.raeume.filter((r) => r.waermeLieferanten?.some((l) => l.raumId === id)).map((r) => r.id),
  ])];

  const kaestenVon = (raum) => {
    const eigene = eindeutig.filter((a) => a.raumId === raum.id);
    const symbol = gesamtVon.get(raum.id);
    return {
      id: raum.id,
      name: raum.name,
      theta: raum.theta,
      flaeche: raum.flaeche,
      status: raum.status,
      statusText: label(STATI, raum.status),
      geschoss: raum.geschoss,
      position: gueltigePosition(raum.plan),
      symbol: symbol?.geprueft ? symbol.gesamt : null,
      verbunden: verbundenMit(raum.id),
      auffaellig: eigene.length > 0,
      auffaelligkeiten: eigene.map((a) => a.text),
    };
  };

  const geschosse = geschossReihenfolge(projekt.raeume.map((r) => r.geschoss)).map((name) => ({
    name,
    kaesten: projekt.raeume.filter((r) => r.geschoss === name).sort((a, b) => a.name.localeCompare(b.name, 'de')).map(kaestenVon),
  }));

  const passivLinien = [];
  for (const raum of projekt.raeume.filter((r) => r.status === 'passiv')) {
    for (const l of raum.waermeLieferanten ?? []) {
      if (raumKarte.has(l.raumId) && l.prozent > 0) passivLinien.push({ id: `p-${raum.id}-${l.raumId}`, von: raum.id, zu: l.raumId, prozent: l.prozent });
    }
  }

  return { geschosse, symbole: zonenSymbole(projekt), linien, passivLinien, auffaelligkeiten: eindeutig, pruefung };
}

// Gültige Position oder null. Werte außerhalb von 0 bis 100 oder Nicht-Zahlen gelten als nicht gesetzt.
export function gueltigePosition(plan) {
  if (!plan || !istZahl(plan.x) || !istZahl(plan.y)) return null;
  if (plan.x < 0 || plan.x > 100 || plan.y < 0 || plan.y > 100) return null;
  return { x: plan.x, y: plan.y };
}

// Text zum Antippen einer Linie: { titel, zeilen }
export function linienDetails(linie) {
  const zeilen = [
    `Raum: ${linie.raumName}`,
    `Grenzt an: ${linie.angrenzendText}`,
    linie.flaeche === null
      ? 'Fläche: unvollständig (Länge, Höhe oder Fläche fehlt)'
      : `Fläche: ${formatZahl(linie.flaeche, 2)} m² brutto, ${formatZahl(linie.netto, 2)} m² netto (ohne Öffnungen)`,
    linie.u ? `U-Wert: ${linie.u.min === linie.u.max ? z(linie.u.min) : `${z(linie.u.min)} – ${z(linie.u.max)}`} W/(m²K)` : 'U-Wert: Bauteil fehlt',
    linie.verlust ? `Verlust: ${wattBereich(linie.verlust.min, linie.verlust.max)}` : 'Verlust: nicht gerechnet',
  ];
  if (linie.waermeText) zeilen.push(linie.waermeText);
  for (const m of linie.marker) zeilen.push(`⚠ ${m.text}`);
  return { titel: `${linie.bezeichnung} (${linie.bauteilName})`, zeilen };
}

// Zeilen für die Tabelle der Vollständigkeitsprüfung: [Raum, Prüfung, Zeichen, Begründung].
// Unbeheizte Räume werden nicht geprüft und erscheinen mit einer Zeile.
export function pruefZeilen(pruefung) {
  return pruefung.flatMap((r) => {
    const raum = `${r.name} (${r.geschoss}, ${label(STATI, r.status)})`;
    if (!r.geprueft) return [[raum, 'Alle Prüfungen', '–', 'Unbeheizter Raum, wird nicht gerechnet und nicht geprüft.']];
    return r.punkte.map((p, i) => [i === 0 ? raum : '', p.titel, ZEICHEN[p.stufe], p.text]);
  });
}

// Eine Zeile je Fläche für die Detailkarten.
function flaechenZeile(linie, ausSichtVon = null) {
  const flaeche = linie.flaeche === null ? 'Fläche unvollständig' : `${formatZahl(linie.netto, 2)} m² netto`;
  const u = linie.u ? `U ${linie.u.min === linie.u.max ? z(linie.u.min) : `${z(linie.u.min)} – ${z(linie.u.max)}`}` : 'U fehlt';
  const verlust = linie.verlust ? wattBereich(linie.verlust.min, linie.verlust.max) : 'nicht gerechnet';
  const ziel = linie.zielArt === 'raum' && ausSichtVon === linie.zielId ? `von „${linie.raumName}“ geführt` : linie.angrenzendText;
  const zeile = `${linie.bezeichnung} (${linie.bauteilName}) · ${ziel} · ${flaeche} · ${u} · ${verlust}`;
  return linie.marker.length > 0 ? `⚠ ${zeile}: ${linie.marker.map((m) => m.text).join(' ')}` : zeile;
}

// Detailkarte eines Raums: alle Flächen mit Gegenseite, Fläche, U-Wert und Verlust, dazu die Auffälligkeiten.
export function raumDetails(plan, raumId) {
  const kasten = plan.geschosse.flatMap((g) => g.kaesten).find((k) => k.id === raumId);
  if (!kasten) return null;
  const eigene = plan.linien.filter((l) => l.raumId === raumId);
  const fremde = plan.linien.filter((l) => l.zielArt === 'raum' && l.zielId === raumId);
  const zeilen = [
    ...eigene.map((l) => flaechenZeile(l)),
    ...fremde.map((l) => flaechenZeile(l, raumId)),
  ];
  const kopf = `${kasten.statusText}, ${typeof kasten.theta === 'number' ? `${z(kasten.theta)} °C` : 'Temperatur fehlt'}, ${typeof kasten.flaeche === 'number' ? `${formatZahl(kasten.flaeche, 1)} m²` : 'Fläche fehlt'}, ${kasten.geschoss}`;
  return {
    titel: kasten.name,
    kopf,
    zeilen: zeilen.length > 0 ? zeilen : ['Keine Raumflächen erfasst.'],
    auffaelligkeiten: kasten.auffaelligkeiten,
  };
}

// Detailkarte einer gebündelten Linie oder eines Symbols: alle Flächen zu dieser Gegenseite.
export function bezugDetails(plan, flaechenIds) {
  const linien = plan.linien.filter((l) => flaechenIds.includes(l.id));
  if (linien.length === 0) return null;
  const summe = linien.reduce((s, l) => s + (l.netto ?? 0), 0);
  return {
    titel: `${linien[0].raumName} → ${linien[0].angrenzendText}`,
    kopf: `${linien.length} Fläche${linien.length === 1 ? '' : 'n'}, zusammen ${formatZahl(summe, 2)} m² netto`,
    zeilen: linien.map((l) => flaechenZeile(l)),
  };
}

// Detailkarte eines Symbols (Außenluft oder Zone): welche Räume grenzen mit wie viel Fläche daran.
export function symbolDetails(plan, symbolId) {
  const symbol = plan.symbole.find((s) => s.id === symbolId);
  if (!symbol) return null;
  const je = new Map();
  for (const l of plan.linien.filter((x) => x.zielId === symbolId)) {
    const e = je.get(l.raumId) ?? { name: l.raumName, flaeche: 0, anzahl: 0 };
    e.flaeche += l.netto ?? 0;
    e.anzahl += 1;
    je.set(l.raumId, e);
  }
  return {
    titel: `${symbol.name} (${symbol.temperatur})`,
    kopf: je.size === 0 ? 'Keine Raumfläche grenzt hier an.' : `${je.size} ${je.size === 1 ? 'Raum grenzt' : 'Räume grenzen'} an.`,
    zeilen: [...je.values()].map((e) => `${e.name}: ${e.anzahl} Fläche${e.anzahl === 1 ? '' : 'n'}, ${formatZahl(e.flaeche, 2)} m² netto`),
  };
}
