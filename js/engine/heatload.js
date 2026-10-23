// Rechenkern: Transmission, Lüftung, Bandbreite und Gebäudesumme.
// Reine Funktionen ohne Bezug zur Oberfläche. Eingaben sind einfache Objekte,
// siehe Kommentar an berechneGebaeude().
//
// Vereinfachtes Verfahren in der Struktur der DIN EN 12831-1.
// Alle Leistungen in W, Temperaturen in °C, Flächen in m², U-Werte in W/(m²K).

export const LUEFTUNGS_FAKTOR = 0.34; // Wh/(m³K)
export const FAELLE = ['guenstig', 'ungunstig'];

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

// Verluste einer Raumfläche nach Abzug der Öffnungen.
// Innenbauteile zu anderen Räumen liefern nichts, siehe Hinweis in berechneFall().
function flaechenVerlust(raum, flaeche, ctx, fall) {
  if (flaeche.angrenzend.art === 'raum') return { wand: 0, oeffnungen: 0 };

  const { kante, zonenKante } = seiten(fall);
  const zone = flaeche.angrenzend.art === 'zone' ? ctx.zonenKarte.get(flaeche.angrenzend.zoneId) : null;
  const fg = zone && zone.art === 'erdreich' ? ctx.einstellungen.fg : 1;
  const thetaGegen = gegenTemperatur(flaeche.angrenzend, ctx.zonenKarte, ctx.einstellungen, zonenKante);
  const dT = raum.theta - thetaGegen;
  const dUWB = ctx.einstellungen.dUWB[kante];

  const oeffnungen = flaeche.oeffnungen ?? [];
  const nettoFlaeche = flaeche.flaeche - summe(oeffnungen.map((o) => o.flaeche));
  if (nettoFlaeche < 0) {
    throw new Error(`Öffnungen größer als Fläche bei ${flaeche.id}`);
  }

  return {
    wand: nettoFlaeche * (flaeche.u[kante] + dUWB) * fg * dT,
    oeffnungen: summe(oeffnungen.map((o) => o.flaeche * (o.uw + dUWB) * fg * dT)),
  };
}

// Alle Verluste eines Raums im Fall, noch ohne Zurechnung passiver Räume.
function raumVerluste(raum, ctx, fall) {
  const { kante } = seiten(fall);
  const huelle = (raum.flaechen ?? []).map((f) => flaechenVerlust(raum, f, ctx, fall));
  const wand = summe(huelle.map((h) => h.wand));
  const oeffnungen = summe(huelle.map((h) => h.oeffnungen));

  const luftwechsel = raum.luftwechsel?.[kante] ?? ctx.einstellungen.luftwechselStandard[kante];
  const lueftung = LUEFTUNGS_FAKTOR * luftwechsel * raum.volumen * (raum.theta - ctx.einstellungen.thetaAussen);

  const aufheizung = ctx.einstellungen.aufheizzuschlag.aktiv
    ? ctx.einstellungen.aufheizzuschlag.wProM2 * raum.flaeche
    : 0;

  return {
    wand,
    oeffnungen,
    lueftung,
    aufheizung,
    netto: wand + oeffnungen + lueftung + aufheizung,
  };
}

// Ein Fall (günstig oder ungünstig) über alle gerechneten Räume.
function berechneFall(rechenbare, ctx, fall) {
  const warnungen = [];
  const eigen = new Map(rechenbare.map((r) => [r.id, raumVerluste(r, ctx, fall)]));

  // Heizlast beheizter Räume beginnt mit dem eigenen Netto-Verlust.
  // Wärmeströme zwischen Räumen fehlen absichtlich: sie heben sich in der Summe auf.
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

  return {
    raeume,
    gebaeude: {
      summe: summe(rechenbare.map((r) => eigen.get(r.id).netto)),
      heizlast: summe([...heizlast.values()]),
    },
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
export function berechneGebaeude({ einstellungen, zonen = [], raeume }) {
  const ctx = {
    einstellungen,
    zonenKarte: new Map(zonen.map((z) => [z.id, z])),
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
      mittel: { summe: (g.summe + u.summe) / 2, heizlast: (g.heizlast + u.heizlast) / 2 },
    },
    warnungen: faelle.guenstig.warnungen,
  };
}
