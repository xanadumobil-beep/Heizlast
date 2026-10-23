// Rechenkern: Transmission, Lüftung, Bandbreite und Gebäudesumme.
// Reine Funktionen ohne Bezug zur Oberfläche. Eingaben sind einfache Objekte,
// siehe Kommentar an berechneGebaeude().
//
// Vereinfachtes Verfahren in der Struktur der DIN EN 12831-1.
// Alle Leistungen in W, Temperaturen in °C, Flächen in m², U-Werte in W/(m²K).

export const LUEFTUNGS_FAKTOR = 0.34; // Wh/(m³K)
export const FAELLE = ['guenstig', 'ungunstig'];
export const GEGENPROBE_TOLERANZ_W = 1; // ab dieser Abweichung zeigt die App eine Warnung

// Eine Rechnung läuft je Fall. Günstig heißt: wenig Verlust.
// U-Wert, ΔU_WB und Luftwechsel nehmen dafür den Minimalwert, die Zonentemperatur den Maximalwert.
// Ungünstig ist jeweils das Gegenteil.
function seiten(fall) {
  return {
    kante: fall === 'guenstig' ? 'min' : 'max', // U-Wert, ΔU_WB, Luftwechsel
    zonenKante: fall === 'guenstig' ? 'max' : 'min', // Temperatur der angrenzenden Zone
  };
}

function summe(werte) {
  return werte.reduce((a, b) => a + b, 0);
}

// Gegen-Temperatur einer Fläche. Außenluft ist fest (Normaußentemperatur),
// Erdreich, unbeheizte Zonen und Nachbarn haben Min/Max.
function gegenTemperatur(angrenzend, zonenKarte, einstellungen, zonenKante) {
  if (angrenzend.art === 'aussen') return einstellungen.thetaAussen;
  const zone = zonenKarte.get(angrenzend.zoneId);
  if (!zone) throw new Error(`Zone nicht gefunden: ${angrenzend.zoneId}`);
  return zone.temperatur[zonenKante];
}

// Raum-zu-Raum: Ein Raum verliert Wärme an einen kälteren Nachbarraum, A · U · (θ_i − θ_Nachbar),
// ohne ΔU_WB. Das wird seiner Raumheizlast angerechnet. Gewinne aus einem wärmeren Nachbarn
// werden nicht gutgeschrieben (sichere Seite, der Nachbar kann abgedreht sein).
// Verluste an einen passiven Raum zählen nicht: dessen Wärmebedarf steckt schon in der
// prozentualen Zurechnung seines Netto-Verlusts, sonst entstünde eine Doppelzählung.
function raumZuRaumVerlust(raum, flaeche, nettoFlaeche, ctx, fall) {
  const nachbarId = flaeche.angrenzend.raumId;
  const nachbar = ctx.raumKarte.get(nachbarId);
  if (!nachbar) return { grund: 'nachbar_unbekannt', nachbarId };
  if (nachbar.status === 'unbeheizt') return { grund: 'nachbar_unbeheizt', nachbarId };
  if (nachbar.status === 'passiv') return { grund: 'nachbar_passiv', nachbarId };
  if (nachbar.theta > raum.theta) return { grund: 'nachbar_waermer', nachbarId };
  if (nachbar.theta === raum.theta) return { grund: 'gleiche_temperatur', nachbarId };

  const { kante } = seiten(fall);
  const oeffnungen = flaeche.oeffnungen ?? [];
  const uA = nettoFlaeche * flaeche.u[kante] + summe(oeffnungen.map((o) => o.flaeche * o.uw));
  return { leistung: uA * (raum.theta - nachbar.theta), nachbarId };
}

// Verluste einer Raumfläche nach Abzug der Öffnungen. Ergebnis:
//   wand, oeffnungen   Verluste an Außenluft, Erdreich, Nachbar, unbeheizte Zone (Gebäudehülle)
//   raumZuRaum         { nachbarId, leistung } für angerechnete Verluste an einen kälteren Raum
//   nichtAngerechnet   { nachbarId, grund } für Flächen zu Räumen, die nichts beitragen
function flaechenVerlust(raum, flaeche, ctx, fall) {
  const oeffnungen = flaeche.oeffnungen ?? [];
  const nettoFlaeche = flaeche.flaeche - summe(oeffnungen.map((o) => o.flaeche));
  if (nettoFlaeche < 0) {
    throw new Error(`Öffnungen größer als Fläche bei ${flaeche.id}`);
  }

  if (flaeche.angrenzend.art === 'raum') {
    const verlust = raumZuRaumVerlust(raum, flaeche, nettoFlaeche, ctx, fall);
    return {
      wand: 0,
      oeffnungen: 0,
      raumZuRaum: verlust.leistung !== undefined ? verlust : null,
      nichtAngerechnet: verlust.leistung === undefined ? verlust : null,
    };
  }

  const { kante, zonenKante } = seiten(fall);
  const zone = flaeche.angrenzend.art === 'zone' ? ctx.zonenKarte.get(flaeche.angrenzend.zoneId) : null;
  const fg = zone && zone.art === 'erdreich' ? ctx.einstellungen.fg : 1;
  const thetaGegen = gegenTemperatur(flaeche.angrenzend, ctx.zonenKarte, ctx.einstellungen, zonenKante);
  const dT = raum.theta - thetaGegen;
  const dUWB = ctx.einstellungen.dUWB[kante];

  return {
    wand: nettoFlaeche * (flaeche.u[kante] + dUWB) * fg * dT,
    oeffnungen: summe(oeffnungen.map((o) => o.flaeche * (o.uw + dUWB) * fg * dT)),
    raumZuRaum: null,
    nichtAngerechnet: null,
  };
}

function lueftungsVerlust(raum, ctx, fall) {
  const { kante } = seiten(fall);
  const luftwechsel = raum.luftwechsel?.[kante] ?? ctx.einstellungen.luftwechselStandard[kante];
  return LUEFTUNGS_FAKTOR * luftwechsel * raum.volumen * (raum.theta - ctx.einstellungen.thetaAussen);
}

function aufheizZuschlag(raum, ctx) {
  const { aktiv, wProM2 } = ctx.einstellungen.aufheizzuschlag;
  return aktiv ? wProM2 * raum.flaeche : 0;
}

// Alle Verluste eines Raums im Fall, noch ohne Zurechnung passiver Räume.
// Die angerechneten Raum-zu-Raum-Verluste gehören zur Raumheizlast, nicht zur Gebäudesumme.
function raumVerluste(raum, ctx, fall) {
  const flaechen = raum.flaechen ?? [];
  const huelle = flaechen.map((f) => flaechenVerlust(raum, f, ctx, fall));
  const wand = summe(huelle.map((h) => h.wand));
  const oeffnungen = summe(huelle.map((h) => h.oeffnungen));
  const lueftung = lueftungsVerlust(raum, ctx, fall);
  const aufheizung = aufheizZuschlag(raum, ctx);

  const raumZuRaum = huelle
    .map((h, i) => (h.raumZuRaum ? { flaecheId: flaechen[i].id, ...h.raumZuRaum } : null))
    .filter(Boolean);
  const nichtAngerechnet = huelle
    .map((h, i) => (h.nichtAngerechnet ? { flaecheId: flaechen[i].id, ...h.nichtAngerechnet } : null))
    .filter(Boolean);
  const raumZuRaumSumme = summe(raumZuRaum.map((r) => r.leistung));

  return {
    wand,
    oeffnungen,
    lueftung,
    aufheizung,
    raumZuRaum,
    raumZuRaumSumme,
    nichtAngerechnet,
    flaechen: flaechen.map((f, i) => ({
      id: f.id,
      wand: huelle[i].wand,
      oeffnungen: huelle[i].oeffnungen,
      raumZuRaum: huelle[i].raumZuRaum?.leistung ?? 0,
    })),
    netto: wand + oeffnungen + lueftung + aufheizung + raumZuRaumSumme,
  };
}

// Gebäudesumme direkt über alle Flächen an Außenluft, Erdreich, Nachbar und unbeheizte Zonen
// (beheizte und passive Räume) plus Lüftung. Sie hängt nicht von der Verteilung
// passiver Räume ab und dient als Maßstab für die Gegenprobe.
function gebaeudeSummeDirekt(rechenbare, ctx, fall) {
  const huelle = summe(
    rechenbare.flatMap((raum) =>
      (raum.flaechen ?? []).map((f) => {
        const v = flaechenVerlust(raum, f, ctx, fall);
        return v.wand + v.oeffnungen;
      }),
    ),
  );
  const lueftung = summe(rechenbare.map((r) => lueftungsVerlust(r, ctx, fall)));
  const aufheizung = summe(rechenbare.map((r) => aufheizZuschlag(r, ctx)));
  return { huelle, lueftung, aufheizung, summe: huelle + lueftung + aufheizung };
}

// Ein Fall (günstig oder ungünstig) über alle gerechneten Räume.
function berechneFall(rechenbare, ctx, fall) {
  const warnungen = [];
  const eigen = new Map(rechenbare.map((r) => [r.id, raumVerluste(r, ctx, fall)]));

  // Räume, deren Flächen auf einen unbekannten oder unbeheizten Raum zeigen, tragen dazu nichts bei.
  // Der Hinweis dient dazu, die Eingabe zu korrigieren (unbeheizte Räume gehören in eine Zone).
  for (const r of rechenbare) {
    for (const n of eigen.get(r.id).nichtAngerechnet) {
      if (n.grund === 'nachbar_unbekannt' || n.grund === 'nachbar_unbeheizt') {
        warnungen.push({ art: 'gegenraum_unbrauchbar', raumId: r.id, flaecheId: n.flaecheId, nachbarId: n.nachbarId, grund: n.grund });
      }
    }
  }

  // Heizlast beheizter Räume beginnt mit dem eigenen Netto-Verlust (inklusive angerechneter
  // Raum-zu-Raum-Verluste). Diese Ströme heben sich im Gebäude auf und stehen nicht in der Gebäudesumme.
  const heizlast = new Map();
  const zugeteilt = new Map(rechenbare.map((r) => [r.id, 0]));
  for (const r of rechenbare) {
    if (r.status === 'beheizt') heizlast.set(r.id, eigen.get(r.id).netto);
  }

  // Netto-Verlust passiver Räume wird prozentual auf die liefernden Räume verteilt.
  for (const p of rechenbare.filter((r) => r.status === 'passiv')) {
    const lieferanten = p.waermeLieferanten ?? [];
    const prozentSumme = summe(lieferanten.map((l) => l.prozent));
    if (lieferanten.length === 0 || Math.abs(prozentSumme - 100) > 0.01) {
      warnungen.push({ art: 'passiv_verteilung', raumId: p.id, summe: prozentSumme });
    }
    for (const l of lieferanten) {
      if (!heizlast.has(l.raumId)) {
        warnungen.push({ art: 'lieferant_kein_beheizter_raum', raumId: p.id, lieferantId: l.raumId });
        continue;
      }
      const anteil = (eigen.get(p.id).netto * l.prozent) / 100;
      heizlast.set(l.raumId, heizlast.get(l.raumId) + anteil);
      zugeteilt.set(l.raumId, zugeteilt.get(l.raumId) + anteil);
    }
  }

  const raeume = new Map(
    rechenbare.map((r) => [
      r.id,
      {
        ...eigen.get(r.id),
        zugeteilt: zugeteilt.get(r.id),
        heizlast: r.status === 'passiv' ? eigen.get(r.id).netto : heizlast.get(r.id),
      },
    ]),
  );

  // Gegenprobe: Die Summe der Raumheizlasten beheizter Räume (mit zugerechneten Anteilen
  // passiver Räume) muss der direkten Gebäudesumme plus den angerechneten Raum-zu-Raum-Verlusten
  // entsprechen. Die Raumsumme darf also um genau diese Verluste größer sein als die Gebäudesumme.
  // Weicht sie um mehr als 1 W davon ab, fehlt Wärme (Differenz positiv) oder wurde doppelt
  // gezählt (Differenz negativ).
  const direkt = gebaeudeSummeDirekt(rechenbare, ctx, fall);
  const raumSumme = summe([...heizlast.values()]);
  const raumZuRaum = summe(rechenbare.map((r) => eigen.get(r.id).raumZuRaumSumme));
  const differenz = direkt.summe + raumZuRaum - raumSumme;
  if (Math.abs(differenz) > GEGENPROBE_TOLERANZ_W) {
    warnungen.push({ art: 'gegenprobe', fall, differenz });
  }

  return {
    raeume,
    gebaeude: { ...direkt, raumZuRaum, heizlast: raumSumme, differenz },
    warnungen,
  };
}

// Berechnet die Heizlast aller Räume und des Gebäudes als Bandbreite.
//
// einstellungen: {
//   thetaAussen: -8,
//   dUWB: { min: 0.05, max: 0.15 },
//   fg: 1,
//   luftwechselStandard: { min: 0.5, max: 1 },
//   aufheizzuschlag: { aktiv: false, wProM2: 0 },
// }
// zonen: [{ id, art: 'erdreich' | 'unbeheizt' | 'nachbar', temperatur: { min, max } }]
// raeume: [{
//   id, name, status: 'beheizt' | 'passiv' | 'unbeheizt',
//   theta, flaeche, volumen,
//   luftwechsel: { min, max } | null,
//   flaechen: [{ id, flaeche, u: { min, max },
//                angrenzend: { art: 'aussen' } | { art: 'zone', zoneId } | { art: 'raum', raumId },
//                oeffnungen: [{ flaeche, uw }] }],
//   waermeLieferanten: [{ raumId, prozent }],   // nur bei status 'passiv', Summe 100
// }]
//
// Unbeheizte Räume werden nicht gerechnet. Ihre Wirkung läuft über die Zone "unbeheizt".
//
// Raum-zu-Raum: Fläche mit angrenzend { art: 'raum' } zählt nur für den wärmeren Raum, der sie
// in seiner Flächenliste führt, und nur gegen einen kälteren beheizten Nachbarn (siehe raumZuRaumVerlust).
// Wird eine Wand in beiden Räumen geführt, zählt nur der Eintrag im wärmeren Raum.
//
// Gebäude je Fall:
//   summe      direkt aus allen Flächen an Außenluft, Erdreich, Nachbar, unbeheizten Zonen + Lüftung
//   raumZuRaum Summe der angerechneten Raum-zu-Raum-Verluste (nur in den Raumheizlasten)
//   heizlast   Summe der Raumheizlasten beheizter Räume inkl. zugerechneter Anteile passiver Räume
//   differenz  summe + raumZuRaum − heizlast; über 1 W entsteht { art: 'gegenprobe', fall, differenz }
export function berechneGebaeude({ einstellungen, zonen = [], raeume }) {
  const ctx = {
    einstellungen,
    zonenKarte: new Map(zonen.map((z) => [z.id, z])),
    raumKarte: new Map(raeume.map((r) => [r.id, r])),
  };
  const rechenbare = raeume.filter((r) => r.status !== 'unbeheizt');
  const faelle = Object.fromEntries(FAELLE.map((fall) => [fall, berechneFall(rechenbare, ctx, fall)]));

  const raeumeErgebnis = rechenbare.map((r) => {
    const g = faelle.guenstig.raeume.get(r.id);
    const u = faelle.ungunstig.raeume.get(r.id);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      guenstig: g,
      ungunstig: u,
      mittel: { heizlast: (g.heizlast + u.heizlast) / 2, netto: (g.netto + u.netto) / 2 },
    };
  });

  const g = faelle.guenstig.gebaeude;
  const u = faelle.ungunstig.gebaeude;
  return {
    raeume: raeumeErgebnis,
    gebaeude: {
      guenstig: g,
      ungunstig: u,
      mittel: {
        summe: (g.summe + u.summe) / 2,
        raumZuRaum: (g.raumZuRaum + u.raumZuRaum) / 2,
        heizlast: (g.heizlast + u.heizlast) / 2,
        differenz: (g.differenz + u.differenz) / 2,
      },
    },
    // Verteilungswarnungen sind in beiden Fällen gleich und kommen nur einmal.
    // Die Gegenprobe gilt je Fall und kommt aus beiden.
    warnungen: [
      ...faelle.guenstig.warnungen,
      ...faelle.ungunstig.warnungen.filter((w) => w.art === 'gegenprobe'),
    ],
  };
}
