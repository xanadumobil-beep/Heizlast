// Brücke zwischen den gespeicherten Daten und dem Rechenkern. Reine Funktionen ohne Oberfläche.
//
// Gespeichert sind Räume, Raumflächen (mit eingebetteten Öffnungen), Bauteile, Öffnungstypen
// und Zonen getrennt. Hier werden daraus die Flächen in m² berechnet und die Eingabe für
// berechneGebaeude() gebaut. Unvollständige Einträge werden ausgelassen und als Hinweis gemeldet,
// damit die Berechnung trotzdem läuft und die Lücke sichtbar bleibt.

const summe = (werte) => werte.reduce((a, b) => a + b, 0);

// Fläche aus Maßen: Länge × Höhe oder direkte Fläche. Liefert NaN, wenn Angaben fehlen.
export function flaecheAusMassen({ modus, laenge, hoehe, flaeche }) {
  const zahlen = modus === 'flaeche' ? [flaeche] : [laenge, hoehe];
  // Ein fehlendes Maß (null) würde in JavaScript als 0 mitgerechnet, deshalb vorher prüfen.
  if (!zahlen.every((x) => typeof x === 'number' && Number.isFinite(x))) return NaN;
  return modus === 'flaeche' ? flaeche : laenge * hoehe;
}

// Gesamtfläche eines Öffnungseintrags (Fläche je Stück mal Anzahl).
export function oeffnungsGesamtflaeche(oeffnung) {
  return flaecheAusMassen(oeffnung) * (oeffnung.anzahl ?? 1);
}

// Nettofläche einer Raumfläche nach Abzug aller Öffnungen.
export function nettoFlaeche(flaeche) {
  return flaecheAusMassen(flaeche) - summe((flaeche.oeffnungen ?? []).map(oeffnungsGesamtflaeche));
}

// Volumen: manuell überschriebener Wert oder Fläche × lichte Höhe.
export function raumVolumen(raum) {
  if (typeof raum.volumenManuell === 'number' && Number.isFinite(raum.volumenManuell)) return raum.volumenManuell;
  return raum.flaeche * raum.hoehe;
}

// "aussen", "zone:<id>", "raum:<id>" im Auswahlfeld, { art, zoneId | raumId } im Datensatz.
export function wahlZuAngrenzend(wahl) {
  if (wahl === 'aussen') return { art: 'aussen' };
  if (wahl.startsWith('zone:')) return { art: 'zone', zoneId: wahl.slice(5) };
  if (wahl.startsWith('raum:')) return { art: 'raum', raumId: wahl.slice(5) };
  return null;
}

export function angrenzendZuWahl(angrenzend) {
  if (!angrenzend || angrenzend.art === 'aussen') return 'aussen';
  return angrenzend.art === 'zone' ? `zone:${angrenzend.zoneId}` : `raum:${angrenzend.raumId}`;
}

const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);

// Baut die Eingabe für berechneGebaeude(). Rückgabe: { eingabe, hinweise }.
// Hinweise: { art, raumId, flaecheId?, nachbarId? } mit art
//   bauteil_fehlt, zone_fehlt, masse_ungueltig, oeffnung_unvollstaendig, oeffnungen_zu_gross,
//   raum_unvollstaendig, gegenseite_fehlt
export function baueRechenEingabe({ einstellungen, zonen, bauteile, oeffnungstypen, raeume, flaechen }) {
  const hinweise = [];
  const bauteilKarte = new Map(bauteile.map((b) => [b.id, b]));
  const typKarte = new Map(oeffnungstypen.map((t) => [t.id, t]));
  const zonenIds = new Set(zonen.map((z) => z.id));

  const eingabeRaeume = raeume.map((raum) => {
    const volumen = raumVolumen(raum);
    const vollstaendig = [raum.theta, raum.flaeche, volumen].every(istZahl);
    if (raum.status !== 'unbeheizt' && !vollstaendig) {
      hinweise.push({ art: 'raum_unvollstaendig', raumId: raum.id });
    }

    const rechenFlaechen = [];
    for (const f of flaechen.filter((x) => x.raumId === raum.id)) {
      const hinweis = (art) => hinweise.push({ art, raumId: raum.id, flaecheId: f.id });
      const bauteil = bauteilKarte.get(f.bauteilId);
      if (!bauteil) { hinweis('bauteil_fehlt'); continue; }
      if (f.angrenzend?.art === 'zone' && !zonenIds.has(f.angrenzend.zoneId)) { hinweis('zone_fehlt'); continue; }
      const brutto = flaecheAusMassen(f);
      if (!Number.isFinite(brutto) || !f.angrenzend) { hinweis('masse_ungueltig'); continue; }

      const oeffnungen = [];
      for (const o of f.oeffnungen ?? []) {
        const typ = typKarte.get(o.typId);
        const gesamt = oeffnungsGesamtflaeche(o);
        if (!typ || !Number.isFinite(gesamt)) { hinweis('oeffnung_unvollstaendig'); continue; }
        oeffnungen.push({ flaeche: gesamt, uw: typ.uw });
      }
      if (brutto - summe(oeffnungen.map((o) => o.flaeche)) < 0) { hinweis('oeffnungen_zu_gross'); continue; }

      rechenFlaechen.push({ id: f.id, flaeche: brutto, u: bauteil.u, angrenzend: f.angrenzend, oeffnungen });
    }

    return {
      id: raum.id,
      name: raum.name,
      // Unvollständige Räume werden wie unbeheizte nicht gerechnet, der Hinweis steht oben.
      status: raum.status !== 'unbeheizt' && !vollstaendig ? 'unbeheizt' : raum.status,
      theta: raum.theta,
      flaeche: raum.flaeche,
      volumen,
      luftwechsel: raum.luftwechsel ?? null,
      flaechen: rechenFlaechen,
      waermeLieferanten: raum.waermeLieferanten ?? [],
    };
  });

  hinweise.push(...gegenseitenHinweise(eingabeRaeume));
  return { eingabe: { einstellungen, zonen, raeume: eingabeRaeume }, hinweise };
}

// Eine Wand zu einem wärmeren Nachbarraum erzeugt dort den Verlust. Führt der wärmere Raum keine
// Fläche zum kälteren Raum, geht dieser Verlust verloren. Das wird gemeldet.
function gegenseitenHinweise(raeume) {
  const hinweise = [];
  const nachId = new Map(raeume.map((r) => [r.id, r]));
  for (const kalt of raeume) {
    if (kalt.status === 'unbeheizt') continue;
    const gemeldet = new Set();
    for (const f of kalt.flaechen) {
      if (f.angrenzend.art !== 'raum') continue;
      const warm = nachId.get(f.angrenzend.raumId);
      if (!warm || warm.status !== 'beheizt' || gemeldet.has(warm.id)) continue;
      if (!(warm.theta > kalt.theta)) continue;
      const fuehrtGegenseite = warm.flaechen.some((g) => g.angrenzend.art === 'raum' && g.angrenzend.raumId === kalt.id);
      if (!fuehrtGegenseite) {
        gemeldet.add(warm.id);
        hinweise.push({ art: 'gegenseite_fehlt', raumId: kalt.id, nachbarId: warm.id });
      }
    }
  }
  return hinweise;
}

// --- Stabile Kennungen ---------------------------------------------------------------
//
// Jede Öffnung (eingebettet in einer Raumfläche) und jeder Heizkörper hat eine dauerhafte,
// eindeutige ID. Sie bleibt bei Bearbeitung, Export und Import erhalten, denn Fotomarkierungen
// (Stufe 2) verweisen darauf. Fehlende oder doppelte IDs innerhalb einer Raumfläche werden ergänzt,
// vorhandene IDs werden nie geändert. neueId erzeugt eine frische ID (db.neueId).
export function mitStabilenIds(store, objekt, neueId) {
  if (store === 'radiators') return objekt.id ? objekt : { ...objekt, id: neueId() };
  if (store !== 'surfaces' || !Array.isArray(objekt.oeffnungen)) return objekt;

  const gesehen = new Set();
  let geaendert = false;
  const oeffnungen = objekt.oeffnungen.map((o) => {
    if (o.id && !gesehen.has(o.id)) {
      gesehen.add(o.id);
      return o;
    }
    geaendert = true;
    const id = neueId();
    gesehen.add(id);
    return { ...o, id };
  });
  return geaendert ? { ...objekt, oeffnungen } : objekt;
}

// Doppelt vergebene IDs im ganzen Projekt (Öffnungen aller Flächen und Heizkörper).
// Beim Import prüft das, ob die Kennungen wirklich eindeutig sind.
export function doppelteIds({ flaechen, heizkoerper = [] }) {
  const zaehler = new Map();
  const merke = (art, id) => {
    const schluessel = `${art}:${id}`;
    zaehler.set(schluessel, (zaehler.get(schluessel) ?? 0) + 1);
  };
  for (const f of flaechen) for (const o of f.oeffnungen ?? []) merke('oeffnung', o.id);
  for (const h of heizkoerper) merke('heizkoerper', h.id);
  return [...zaehler].filter(([, n]) => n > 1).map(([schluessel]) => schluessel);
}

// --- Heizkörper --------------------------------------------------------------------------

// Kennlinie von Wärmepumpen-Heizkörpern als Text: ein Wertepaar (Vorlauftemperatur, Leistung) je Zeile,
// zum Beispiel "35 600". Trenner sind Leerzeichen oder Semikolon, Dezimalkomma ist erlaubt.
// Rückgabe: { paare: [{ vorlauf, leistung }], fehler: [{ zeile, text }] }
export function parseKennlinie(text) {
  const paare = [];
  const fehler = [];
  const gesehen = new Set();
  String(text ?? '').split('\n').forEach((roh, index) => {
    const zeile = index + 1;
    const inhalt = roh.trim();
    if (inhalt === '') return;
    const teile = inhalt.split(/[\s;]+/).filter(Boolean).map((t) => t.replace(',', '.'));
    const zahlen = teile.map((t) => (/^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN));
    if (teile.length !== 2 || zahlen.some(Number.isNaN)) {
      fehler.push({ zeile, text: 'bitte Vorlauftemperatur und Leistung eingeben, zum Beispiel „45 1000“.' });
      return;
    }
    const [vorlauf, leistung] = zahlen;
    if (leistung <= 0) {
      fehler.push({ zeile, text: 'die Leistung muss größer als 0 sein.' });
    } else if (gesehen.has(vorlauf)) {
      fehler.push({ zeile, text: `die Vorlauftemperatur ${vorlauf} kommt doppelt vor.` });
    } else {
      gesehen.add(vorlauf);
      paare.push({ vorlauf, leistung });
    }
  });
  return { paare, fehler };
}

export function kennlinieZuText(paare) {
  return (paare ?? []).map((p) => `${String(p.vorlauf).replace('.', ',')} ${String(p.leistung).replace('.', ',')}`).join('\n');
}

// Normleistung eines Heizkörpers: eingetragener Wert, sonst Leistung je Glied mal Gliederzahl.
// Fehlen beide, ist die Leistung unbekannt (null). Es gibt keinen Ersatzwert.
export function normleistungVon(h) {
  if (typeof h.normleistung === 'number' && h.normleistung > 0) return h.normleistung;
  if (typeof h.leistungJeGlied === 'number' && h.leistungJeGlied > 0 && typeof h.gliederzahl === 'number' && h.gliederzahl > 0) {
    return h.leistungJeGlied * h.gliederzahl;
  }
  return null;
}

// Gespeicherte Heizkörper in die Form für den Rechenkern bringen. Der Exponent kommt aus dem
// Heizkörper, sonst aus den Einstellungen.
export function baueHeizkoerperEingabe(heizkoerper, einstellungen) {
  return heizkoerper.map((h) => ({
    id: h.id,
    raumId: h.raumId,
    status: h.status,
    bauart: h.bauart,
    ventil: h.ventil,
    phiN: normleistungVon(h),
    n: typeof h.exponent === 'number' ? h.exponent : einstellungen.heizkoerperExponent,
    norm: { tV: h.normVorlauf, tR: h.normRuecklauf, ti: h.normRaum },
    kennlinie: h.kennlinie ?? [],
    kennlinieRaumtemperatur: h.kennlinieRaumtemperatur,
  }));
}
