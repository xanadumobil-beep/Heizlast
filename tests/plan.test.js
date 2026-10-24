// Tests für Plan und Vollständigkeitsprüfung am fiktiven Beispielhaus (examples/beispiel-mini-haus.json).
//
// Das Beispielhaus: Wohnzimmer (20 m², 20 °C), Bad (6 m², 22 °C), Flur (8 m², passiv, 15 °C), alle EG.
// Wohnzimmer: Außenwand Süd, Westwand zum Nachbarn, Dach 20 m², Bodenplatte 20 m², Wand zum Bad 6 m², Wand zum Flur 5 m².
// Bad: Außenwand, Dach 6 m², Bodenplatte 6 m², Wand zum Wohnzimmer 6 m². Flur: Eingangswand, Dach 8 m²,
// Boden über Keller (Kellerdecke) 8 m², Wand zum Wohnzimmer 5 m².
// Von den 14 Raumflächen sind zwei Wände doppelt eingetragen (Wohnzimmer↔Bad, Wohnzimmer↔Flur): der Plan zeichnet
// jede Wand einmal, also 12 Linien.

import { test, wahr, gleich } from './runner.js';
import { pruefeImport, projektAusSpeicher, baueExport } from '../js/io.js';
import { rechne } from '../js/daten.js';
import {
  baueplan, pruefeVollstaendigkeit, pruefZeilen, gueltigePosition, linienDetails, geschossReihenfolge, raumDetails, bezugDetails, symbolDetails,
} from '../js/plan.js';
import {
  geometrie, klemmePosition, linienBreite, rasterPlaetze, positionenFuerGeschoss, FLAECHE_B, FLAECHE_H, KASTEN_B, KASTEN_H, mittelpunktGrenzen,
} from '../js/planlayout.js';
import { baueBericht } from '../js/bericht.js';

async function ladeText() {
  const adresse = new URL('../examples/beispiel-mini-haus.json', import.meta.url);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(adresse, 'utf8');
  }
  return (await fetch(adresse)).text();
}

const projekt = async () => projektAusSpeicher(pruefeImport(await ladeText()).daten);
const planVon = (p) => baueplan(p, rechne(p).ergebnis);
const raumPruefung = (p, id) => pruefeVollstaendigkeit(p).find((r) => r.raumId === id);
const punktVon = (r, id) => r.punkte.find((x) => x.id === id);
const jetzt = new Date(2026, 9, 24);

// --- Vollständigkeit ------------------------------------------------------------------------------

test('Vollständigkeit: das Beispielhaus ist in allen Räumen vollständig (✓)', async () => {
  const pruefung = pruefeVollstaendigkeit(await projekt());
  gleich(pruefung.length, 3, 0, 'drei Räume');
  for (const r of pruefung) {
    wahr(r.gesamt === 'ok', `${r.name}: ${r.gesamt}`);
    wahr(r.punkte.every((p) => p.stufe === 'ok'), `${r.name}: alle Punkte in Ordnung`);
  }
  const wohnen = raumPruefung(await projekt(), 'raum-wohnen');
  wahr(['dach', 'boden', 'dachflaeche', 'bodenflaeche', 'huelle', 'masse', 'heizkoerper'].every((id) => punktVon(wohnen, id)), 'EG-Raum mit beheiztem Status: alle sieben Prüfpunkte');
  const flur = raumPruefung(await projekt(), 'raum-flur');
  wahr(punktVon(flur, 'lieferanten')?.stufe === 'ok' && !punktVon(flur, 'heizkoerper'), 'passiver Raum: Wärmelieferanten statt Heizkörper');
  wahr(punktVon(wohnen, 'dachflaeche').text.includes('20,00 m²') && punktVon(wohnen, 'dachflaeche').text.includes('Abweichung 0,0 %'), 'Text nennt Flächen');
});

test('Vollständigkeit: fehlendes Dach im EG ist ein ✗', async () => {
  const p = await projekt();
  p.flaechen = p.flaechen.filter((f) => f.id !== 'fl-bad-dach');
  const bad = raumPruefung(p, 'raum-bad');
  wahr(punktVon(bad, 'dach').stufe === 'fehler' && punktVon(bad, 'dach').text.includes('Kein Dach'), 'Dach fehlt');
  wahr(!punktVon(bad, 'dachflaeche'), 'ohne Dach keine Flächenprüfung');
  wahr(bad.gesamt === 'fehler', 'Gesamtbild ✗');
  wahr(raumPruefung(p, 'raum-wohnen').gesamt === 'ok', 'andere Räume unberührt');
});

test('Vollständigkeit: fehlender Boden im EG ist ein ✗, Kellerdecke und Bodenplatte zählen', async () => {
  const p = await projekt();
  p.flaechen = p.flaechen.filter((f) => f.id !== 'fl-wohnen-boden');
  wahr(punktVon(raumPruefung(p, 'raum-wohnen'), 'boden').stufe === 'fehler', 'Wohnzimmer ohne Bodenplatte');
  wahr(punktVon(raumPruefung(p, 'raum-flur'), 'boden').stufe === 'ok', 'Flur: Kellerdecke genügt');
  // Decke zu einem Raum im Keller zählt als Boden (Gegenraum).
  p.raeume.push({ id: 'raum-keller', name: 'Hobbykeller', geschoss: 'Keller', status: 'beheizt', theta: 15, flaeche: 20, hoehe: 2.2, waermeLieferanten: [] });
  p.flaechen.push({ id: 'fl-decke', raumId: 'raum-wohnen', bauteilId: 'bt-innenwand', angrenzend: { art: 'raum', raumId: 'raum-keller' }, modus: 'flaeche', flaeche: 20, oeffnungen: [] });
  p.bauteile.push({ id: 'bt-decke', name: 'Geschossdecke', art: 'innendecke', u: { min: 1, max: 1.4 }, quelle: 'schaetzung' });
  p.flaechen.find((f) => f.id === 'fl-decke').bauteilId = 'bt-decke';
  wahr(punktVon(raumPruefung(p, 'raum-wohnen'), 'boden').stufe === 'ok', 'Innendecke zu einem Kellerraum zählt als Boden');
});

test('Vollständigkeit: Flächenabweichung über 10 % ist ein ⚠, genau 10 % noch nicht', async () => {
  const p = await projekt();
  const setze = (id, flaeche) => { p.flaechen.find((f) => f.id === id).flaeche = flaeche; };
  setze('fl-wohnen-dach', 22); // 20 m² Raum: genau +10 %
  gleich(punktVon(raumPruefung(p, 'raum-wohnen'), 'dachflaeche').stufe === 'ok' ? 1 : 0, 1, 0, '22 m² bei 20 m² Raumfläche: genau 10 %, ok');
  setze('fl-wohnen-dach', 22.2); // +11 %
  const gross = punktVon(raumPruefung(p, 'raum-wohnen'), 'dachflaeche');
  wahr(gross.stufe === 'warnung' && gross.text.includes('11,0 % größer') && gross.text.includes('22,20 m²'), `Dach zu groß: ${gross.text}`);
  setze('fl-wohnen-dach', 17.9); // −10,5 %
  const klein = punktVon(raumPruefung(p, 'raum-wohnen'), 'dachflaeche');
  wahr(klein.stufe === 'warnung' && klein.text.includes('10,5 % kleiner'), `Dach zu klein: ${klein.text}`);
  setze('fl-wohnen-dach', 20);
  setze('fl-wohnen-boden', 16); // −20 %
  const boden = punktVon(raumPruefung(p, 'raum-wohnen'), 'bodenflaeche');
  wahr(boden.stufe === 'warnung' && boden.text.includes('20,0 % kleiner'), `Boden zu klein: ${boden.text}`);
  wahr(raumPruefung(p, 'raum-wohnen').gesamt === 'warnung', 'Gesamtbild ⚠');
});

test('Vollständigkeit: mehrere Bodenflächen werden summiert', async () => {
  const p = await projekt();
  // Das Bad (6 m²) hat zwei Bodenplatten à 3 m²: Summe 6 m² passt.
  const boden = p.flaechen.find((f) => f.id === 'fl-bad-boden');
  boden.flaeche = 3;
  p.flaechen.push({ ...boden, id: 'fl-bad-boden2' });
  const bad = raumPruefung(p, 'raum-bad');
  wahr(punktVon(bad, 'bodenflaeche').stufe === 'ok' && punktVon(bad, 'bodenflaeche').text.includes('6,00 m²'), 'Summe 6 m² im Rahmen');
  boden.flaeche = 2; // Summe 5 m²: −16,7 %
  wahr(punktVon(raumPruefung(p, 'raum-bad'), 'bodenflaeche').stufe === 'warnung', 'Summe 5 m² weicht ab');
});

test('Vollständigkeit: Kellerraum braucht eine Bodenplatte, aber kein Dach', async () => {
  const p = await projekt();
  p.raeume.push({ id: 'raum-keller', name: 'Waschkeller', geschoss: 'Keller', status: 'beheizt', theta: 18, flaeche: 12, hoehe: 2.2, waermeLieferanten: [] });
  p.flaechen.push({ id: 'fl-k-wand', raumId: 'raum-keller', bauteilId: 'bt-aussenwand', angrenzend: { art: 'zone', zoneId: 'zone-erdreich' }, modus: 'flaeche', flaeche: 10, oeffnungen: [] });
  const ohne = raumPruefung(p, 'raum-keller');
  wahr(punktVon(ohne, 'boden').stufe === 'fehler' && punktVon(ohne, 'boden').titel === 'Bodenplatte', 'Bodenplatte fehlt');
  wahr(!punktVon(ohne, 'dach'), 'für Kellerräume wird kein Dach verlangt');
  p.flaechen.push({ id: 'fl-k-boden', raumId: 'raum-keller', bauteilId: 'bt-boden', angrenzend: { art: 'zone', zoneId: 'zone-erdreich' }, modus: 'flaeche', flaeche: 12, oeffnungen: [] });
  const mit = raumPruefung(p, 'raum-keller');
  wahr(punktVon(mit, 'boden').stufe === 'ok' && punktVon(mit, 'bodenflaeche').stufe === 'ok', 'Bodenplatte 12 m² passt zu 12 m²');
  // Ein Kellerraum ohne Bodenplatte in der Plan-Tabelle: ✗ in der Zeile.
  const zeilen = pruefZeilen(pruefeVollstaendigkeit(p).filter((r) => r.raumId === 'raum-keller'));
  wahr(zeilen[0][0].includes('Waschkeller (Keller, Beheizt)'), 'Zeilenkopf mit Geschoss und Status');
});

test('Vollständigkeit: ohne Fläche an Außenluft, Nachbar oder Zone ist ein ✗', async () => {
  const p = await projekt();
  p.flaechen = p.flaechen.filter((f) => f.raumId !== 'raum-bad' || f.angrenzend.art === 'raum');
  const bad = raumPruefung(p, 'raum-bad');
  wahr(punktVon(bad, 'huelle').stufe === 'fehler', 'Bad nur noch mit Wand zum Wohnzimmer');
  wahr(punktVon(bad, 'dach').stufe === 'fehler' && punktVon(bad, 'boden').stufe === 'fehler', 'Dach und Boden fehlen ebenfalls');
});

test('Vollständigkeit: Heizkörper fehlt (✗), Leistung fehlt (⚠), entfallender Heizkörper zählt nicht', async () => {
  const p = await projekt();
  wahr(punktVon(raumPruefung(p, 'raum-wohnen'), 'heizkoerper').text.startsWith('2 Heizkörper'), 'Wohnzimmer: Platte und Wärmepumpen-Heizkörper zählen, der entfallende Guss nicht');

  p.heizkoerper = p.heizkoerper.map((h) => (h.id === 'hk-bad-handtuch' ? { ...h, normleistung: null } : h));
  const ohneLeistung = punktVon(raumPruefung(p, 'raum-bad'), 'heizkoerper');
  wahr(ohneLeistung.stufe === 'warnung' && ohneLeistung.text === 'Leistung fehlt bei 1 von 1 Heizkörper.', ohneLeistung.text);

  p.heizkoerper = p.heizkoerper.filter((h) => h.raumId !== 'raum-bad');
  wahr(punktVon(raumPruefung(p, 'raum-bad'), 'heizkoerper').stufe === 'fehler', 'Bad ohne Heizkörper');

  p.heizkoerper = p.heizkoerper.filter((h) => h.id === 'hk-wohnen-glieder');
  const nurEntfallend = punktVon(raumPruefung(p, 'raum-wohnen'), 'heizkoerper');
  wahr(nurEntfallend.stufe === 'fehler', 'nur ein entfallender Heizkörper: kein Heizkörper');
});

test('Vollständigkeit: Wärmepumpen-Heizkörper ohne zwei Wertepaare gilt als fehlende Leistung', async () => {
  const p = await projekt();
  p.heizkoerper = p.heizkoerper.filter((h) => h.raumId !== 'raum-wohnen' || h.id === 'hk-wohnen-wp');
  p.heizkoerper.find((h) => h.id === 'hk-wohnen-wp').kennlinie = [{ vorlauf: 35, leistung: 600 }];
  wahr(punktVon(raumPruefung(p, 'raum-wohnen'), 'heizkoerper').stufe === 'warnung', 'ein Wertepaar genügt nicht');
});

test('Vollständigkeit: Wärmelieferanten eines passiven Raums müssen 100 % ergeben', async () => {
  const p = await projekt();
  p.raeume.find((r) => r.id === 'raum-flur').waermeLieferanten = [{ raumId: 'raum-wohnen', prozent: 50 }, { raumId: 'raum-bad', prozent: 40 }];
  const punkt = punktVon(raumPruefung(p, 'raum-flur'), 'lieferanten');
  wahr(punkt.stufe === 'warnung' && punkt.text.includes('90,0 %'), punkt.text);
});

test('Vollständigkeit: unvollständige Maße einer Fläche sind ein ✗ und die Flächensumme wird nicht geprüft', async () => {
  const p = await projekt();
  const dach = p.flaechen.find((f) => f.id === 'fl-bad-dach');
  dach.flaeche = null;
  const bad = raumPruefung(p, 'raum-bad');
  wahr(punktVon(bad, 'masse').stufe === 'fehler', 'Maße unvollständig');
  wahr(punktVon(bad, 'dachflaeche').stufe === 'warnung' && punktVon(bad, 'dachflaeche').text.includes('nicht prüfen'), 'Flächenprüfung nicht möglich');
});

test('Vollständigkeit: unbeheizte Räume werden nicht geprüft', async () => {
  const p = await projekt();
  p.raeume.push({ id: 'raum-pool', name: 'Poolraum', geschoss: 'EG', status: 'unbeheizt', theta: null, flaeche: 30, hoehe: 3, waermeLieferanten: [] });
  const pool = raumPruefung(p, 'raum-pool');
  wahr(pool.geprueft === false && pool.gesamt === 'ok' && pool.punkte.length === 0, 'keine Prüfpunkte');
  wahr(pruefZeilen([pool])[0][3].includes('nicht gerechnet'), 'Tabellenzeile erklärt das');
});

// --- Plan: Linien, Pfeile, Markierungen -----------------------------------------------------------

test('Plan: Beispielhaus hat 3 Kästen im EG, 12 Linien und 2 Linien zu den Wärmelieferanten', async () => {
  const plan = planVon(await projekt());
  wahr(plan.geschosse.length === 1 && plan.geschosse[0].name === 'EG' && plan.geschosse[0].kaesten.length === 3, 'ein Geschoss mit drei Kästen');
  gleich(plan.linien.length, 12, 0, 'Linien');
  wahr(plan.symbole.map((s) => s.name).join(',') === 'Außenluft,Nachbargebäude,Keller (unbeheizt),Erdreich', `Symbole: ${plan.symbole.map((s) => s.name)}`);
  wahr(plan.passivLinien.length === 2 && plan.passivLinien.find((l) => l.zu === 'raum-wohnen').prozent === 60 && plan.passivLinien.find((l) => l.zu === 'raum-bad').prozent === 40, 'Flur liefert 60 % Wohnzimmer, 40 % Bad');
  wahr(plan.auffaelligkeiten.length === 0, 'keine Auffälligkeiten im Beispielhaus');
  const farben = Object.fromEntries(plan.linien.map((l) => [l.id, l.farbe]));
  wahr(farben['l-fl-wohnen-aussen'] === 'aussen' && farben['l-fl-wohnen-boden'] === 'erdreich' && farben['l-fl-wohnen-nachbar'] === 'nachbar'
    && farben['l-fl-flur-boden'] === 'unbeheizt' && farben['l-fl-bad-wohnen'] === 'raum', 'Farbe nach Art der Gegenseite');
});

test('Plan: Raum-zu-Raum-Pfeil zeigt vom wärmeren Bad (22 °C) zum Wohnzimmer (20 °C) mit 22 bis 26 W', async () => {
  const plan = planVon(await projekt());
  const wand = plan.linien.find((l) => l.id === 'l-fl-bad-wohnen');
  wahr(wand.pfeil.von === 'raum-bad' && wand.pfeil.nach === 'raum-wohnen', 'Pfeil Bad → Wohnzimmer');
  wahr(Math.abs(wand.verlust.min - 22.07) < 0.5 && wand.verlust.max > wand.verlust.min && wand.verlust.max < 27, `Verlust ${wand.verlust.min} bis ${wand.verlust.max}`);
  wahr(!plan.linien.some((l) => l.id === 'l-fl-wohnen-bad'), 'die Gegenseite im Wohnzimmer wird nicht zusätzlich gezeichnet');
  wahr(wand.marker.length === 0 && wand.gegenseiteEingetragen === true, 'Wand ist beidseitig eingetragen');
  const flur = plan.linien.find((l) => l.farbe === 'raum' && l.id !== 'l-fl-bad-wohnen');
  wahr(flur.pfeil === null && flur.waermeText.includes('passiven Raum'), 'zum passiven Flur gibt es keinen Pfeil');
  const d = linienDetails(wand);
  wahr(d.titel.includes('Wand zum Wohnzimmer') && d.zeilen.some((z) => z.includes('6,00 m²')) && d.zeilen.some((z) => z.includes('1,8 – 2,2')) && d.zeilen.some((z) => z.includes('W')), 'Details beim Antippen');
});

test('Plan: Verlust einer Außenwandlinie entspricht der Rechnung (Südwand Wohnzimmer 626 bis 750 W)', async () => {
  const plan = planVon(await projekt());
  const sued = plan.linien.find((l) => l.id === 'l-fl-wohnen-aussen');
  wahr(Math.round(sued.verlust.min) === 626 && Math.round(sued.verlust.max) === 750, `${sued.verlust.min} bis ${sued.verlust.max}`);
  wahr(Math.abs(sued.flaeche - 12.5) < 1e-9 && Math.abs(sued.netto - 8.02) < 1e-9, 'brutto 12,5 m², netto 8,02 m²');
  wahr(linienDetails(sued).zeilen.includes('Verlust: 626 – 750 W'), 'Text „Verlust: 626 – 750 W“');
});

test('Plan: Wand nur im wärmeren Raum eingetragen wird markiert, der Verlust zählt trotzdem', async () => {
  const p = await projekt();
  p.flaechen = p.flaechen.filter((f) => f.id !== 'fl-wohnen-bad');
  const plan = planVon(p);
  const wand = plan.linien.find((l) => l.id === 'l-fl-bad-wohnen');
  wahr(wand.marker.length === 1 && wand.marker[0].art === 'einseitig' && wand.marker[0].text.includes('trotzdem angerechnet'), 'markiert, mit Hinweis');
  wahr(wand.pfeil !== null, 'Pfeil bleibt, weil der Verlust angerechnet wird');
  wahr(plan.auffaelligkeiten.some((a) => a.raumId === 'raum-bad') && plan.auffaelligkeiten.some((a) => a.raumId === 'raum-wohnen'), 'beide Räume betroffen');
  wahr(plan.geschosse[0].kaesten.find((k) => k.id === 'raum-bad').auffaellig, 'Kasten Bad rot');
});

test('Plan: Wand nur im kälteren Raum eingetragen: markiert, ohne Pfeil, Verlust fehlt in der Rechnung', async () => {
  const p = await projekt();
  p.flaechen = p.flaechen.filter((f) => f.id !== 'fl-bad-wohnen');
  const plan = planVon(p);
  const wand = plan.linien.find((l) => l.id === 'l-fl-wohnen-bad');
  wahr(wand.pfeil === null && wand.marker[0].text.includes('nur in „Wohnzimmer“') && wand.marker[0].text.includes('nicht angerechnet'), wand.marker[0]?.text);
  wahr(plan.auffaelligkeiten.length >= 2, 'beide Räume erhalten die Markierung');
});

test('Plan: Fläche ohne Länge, Höhe oder Fläche wird markiert und hat Standardbreite', async () => {
  const p = await projekt();
  p.flaechen.find((f) => f.id === 'fl-bad-aussen').hoehe = null;
  const plan = planVon(p);
  const linie = plan.linien.find((l) => l.id === 'l-fl-bad-aussen');
  wahr(linie.marker[0].art === 'masse' && linie.flaeche === null && linie.verlust === null, 'markiert, ohne Verlust');
  wahr(linienDetails(linie).zeilen.includes('Verlust: nicht gerechnet'), 'Details nennen „nicht gerechnet“');
  const g = geometrie(plan, { bezuege: 'alle' });
  const gl = g.linien.find((l) => l.id === 'b-raum-bad|aussen');
  wahr(gl.markiert === true && gl.flaechenIds.length === 2, 'Geometrie: gebündelte Linie zur Außenluft ist markiert');
  wahr(g.kaesten.find((k) => k.id === 'raum-bad').marken.find((m) => m.farbe === 'aussen').markiert === true, 'Marke im Kasten ebenfalls');
  wahr(plan.auffaelligkeiten.some((a) => a.raumId === 'raum-bad' && a.text.includes('Länge, Höhe oder Fläche fehlt')), 'in der Liste der Auffälligkeiten');
});

test('Plan: beheizter Raum an passivem Raum ohne Wärmeanteil wird markiert (wie die Warnung des Rechenkerns)', async () => {
  const p = await projekt();
  // Der Flur liefert nun nur noch an das Bad (100 %). Das Wohnzimmer grenzt an den Flur, bekommt aber 0 %.
  p.raeume.find((r) => r.id === 'raum-flur').waermeLieferanten = [{ raumId: 'raum-bad', prozent: 100 }];
  const { ergebnis } = rechne(p);
  wahr(ergebnis.warnungen.some((w) => w.art === 'passiv_ohne_anteil' && w.raumId === 'raum-wohnen'), 'Rechenkern warnt');
  const plan = baueplan(p, ergebnis);
  wahr(plan.auffaelligkeiten.some((a) => a.raumId === 'raum-wohnen' && a.art === 'passiv_ohne_anteil'), 'Plan markiert das Wohnzimmer');
  wahr(plan.linien.filter((l) => l.marker.some((m) => m.art === 'passiv_ohne_anteil')).length >= 1, 'und die Wand zum Flur');
  wahr(plan.geschosse[0].kaesten.find((k) => k.id === 'raum-wohnen').auffaellig, 'Kasten rot umrandet');
  // Mit Anteil ist alles wieder ruhig.
  p.raeume.find((r) => r.id === 'raum-flur').waermeLieferanten = [{ raumId: 'raum-wohnen', prozent: 60 }, { raumId: 'raum-bad', prozent: 40 }];
  wahr(planVon(p).auffaelligkeiten.length === 0, 'ohne Auffälligkeiten');
});

test('Plan: Heizkörper ohne Leistung markiert den Raum', async () => {
  const p = await projekt();
  p.heizkoerper = p.heizkoerper.map((h) => (h.id === 'hk-bad-handtuch' ? { ...h, normleistung: null } : h));
  const plan = planVon(p);
  const bad = plan.geschosse[0].kaesten.find((k) => k.id === 'raum-bad');
  wahr(bad.auffaellig && bad.auffaelligkeiten[0] === 'Heizkörper ohne Leistung: 1.', bad.auffaelligkeiten.join('|'));
  wahr(bad.symbol === 'warnung', 'Prüfzeichen im Kasten: ⚠');
  wahr(!plan.geschosse[0].kaesten.find((k) => k.id === 'raum-wohnen').auffaellig, 'Wohnzimmer unauffällig');
});

test('Plan: Geschosse stehen von oben nach unten (EG vor Keller), unbekannte Geschosse zuletzt', async () => {
  wahr(geschossReihenfolge(['Keller', 'EG', 'Keller']).join(',') === 'EG,Keller', 'Reihenfolge');
  wahr(geschossReihenfolge(['Keller', 'Dachboden', 'OG', 'EG']).join(',') === 'OG,EG,Keller,Dachboden', 'mit OG und fremdem Geschoss');
  const p = await projekt();
  p.raeume.push({ id: 'raum-keller', name: 'Heizraum', geschoss: 'Keller', status: 'unbeheizt', theta: null, flaeche: 9, hoehe: 2.2, waermeLieferanten: [] });
  const plan = planVon(p);
  wahr(plan.geschosse.map((g) => g.name).join(',') === 'EG,Keller', 'beide Geschosse');
  const g = geometrie(plan);
  wahr(g.boeden[1].y > g.boeden[0].y + g.boeden[0].h, 'Keller liegt unter dem EG');
  wahr(g.kaesten.find((k) => k.id === 'raum-keller').cy > g.boeden[1].y, 'Kasten im Kellerfeld');
});

// --- Geometrie und Positionen ----------------------------------------------------------------------

test('Layout: Räume ohne Position erhalten ein Raster ohne Überlappung', async () => {
  const plan = planVon(await projekt());
  const g = geometrie(plan);
  gleich(g.kaesten.length, 3, 0, 'drei Kästen');
  for (let i = 0; i < g.kaesten.length; i += 1) {
    wahr(!g.kaesten[i].gespeichert, 'automatisch angeordnet');
    for (let j = i + 1; j < g.kaesten.length; j += 1) {
      const a = g.kaesten[i];
      const b = g.kaesten[j];
      wahr(Math.abs(a.cx - b.cx) >= KASTEN_B || Math.abs(a.cy - b.cy) >= KASTEN_H, `${a.name} und ${b.name} überlappen nicht`);
    }
    wahr(g.kaesten[i].x >= 0 && g.kaesten[i].x + KASTEN_B <= FLAECHE_B, 'Kasten liegt in der Zeichenfläche');
  }
});

test('Layout: gespeicherte Positionen (Prozent der Zeichenfläche) werden übernommen, freie Plätze für die übrigen', async () => {
  const p = await projekt();
  p.raeume.find((r) => r.id === 'raum-wohnen').plan = { x: 50, y: 50 };
  const g = geometrie(planVon(p));
  const wohnen = g.kaesten.find((k) => k.id === 'raum-wohnen');
  wahr(wohnen.gespeichert && Math.abs(wohnen.cx - FLAECHE_B / 2) < 1e-9 && Math.abs(wohnen.cy - (g.boeden[0].y + FLAECHE_H / 2)) < 1e-9, 'Mittelpunkt bei 50 %/50 %');
  wahr(wohnen.prozent.x === 50 && wohnen.prozent.y === 50, 'Prozentwerte bleiben erhalten');
  for (const k of g.kaesten.filter((x) => x.id !== 'raum-wohnen')) {
    wahr(Math.abs(k.cx - wohnen.cx) >= KASTEN_B || Math.abs(k.cy - wohnen.cy) >= KASTEN_H, `${k.name} überdeckt das verschobene Wohnzimmer nicht`);
  }
});

test('Layout: Positionen werden in die Zeichenfläche geklemmt, ungültige Werte gelten als nicht gesetzt', () => {
  const grenzen = mittelpunktGrenzen();
  const links = klemmePosition({ x: -10, y: 500 });
  wahr(Math.abs(links.x - Math.round(grenzen.xMin * 10) / 10) < 1e-9 && Math.abs(links.y - Math.round(grenzen.yMax * 10) / 10) < 0.11, `geklemmt auf ${links.x}/${links.y}`);
  wahr(gueltigePosition({ x: 20, y: 30 }).x === 20, 'gültig');
  for (const ungueltig of [null, undefined, {}, { x: 'a', y: 1 }, { x: 101, y: 5 }, { x: 5, y: -1 }, { x: NaN, y: 5 }]) {
    wahr(gueltigePosition(ungueltig) === null, `ungültig: ${JSON.stringify(ungueltig)}`);
  }
  gleich(rasterPlaetze(5).length, 5, 0, 'Rasterplätze');
  const pos = positionenFuerGeschoss([{ id: 'a', position: null }, { id: 'b', position: { x: 50, y: 50 } }]);
  wahr(pos.get('b').gespeichert && !pos.get('a').gespeichert, 'gespeichert und automatisch unterschieden');
});

test('Geometrie: Linien beginnen und enden am Rand der Kästen und Symbole, Breite folgt der Fläche', async () => {
  const g = geometrie(planVon(await projekt()), { bezuege: 'alle' });
  const ziele = new Map([...g.kaesten, ...g.symbole].map((t) => [t.id, t]));
  const amRand = (punkt, t) => {
    const dx = Math.abs(punkt.x - t.cx);
    const dy = Math.abs(punkt.y - t.cy);
    const aufRand = Math.abs(dx - t.b / 2) < 0.2 && dy <= t.h / 2 + 0.2 || Math.abs(dy - t.h / 2) < 0.2 && dx <= t.b / 2 + 0.2;
    return aufRand;
  };
  for (const l of g.linien) {
    wahr(amRand({ x: l.x1, y: l.y1 }, ziele.get(l.raumId)), `${l.id}: Anfang am Raumrand`);
    wahr(amRand({ x: l.x2, y: l.y2 }, ziele.get(l.zielId)), `${l.id}: Ende am Rand der Gegenseite`);
  }
  wahr(linienBreite(20) > linienBreite(2) && linienBreite(2) > linienBreite(0.1) && linienBreite(10000) <= 12 && linienBreite(null) === linienBreite(0), 'Linienbreite wächst mit der Fläche, ist begrenzt');
  const pfeile = g.linien.filter((l) => l.pfeil);
  gleich(pfeile.length, 1, 0, 'ein Pfeil (Bad → Wohnzimmer)');
  wahr(pfeile[0].pfeil.split(' ').length === 3, 'Pfeil als Dreieck');
  gleich(g.passivLinien.length, 2, 0, 'zwei gestrichelte Linien');
  wahr(g.symbole.every((s) => s.x === 830 && s.y >= 0 && s.y + s.h <= g.hoehe), 'Symbole in der rechten Spalte');
});

test('Geometrie: mehrere Wände zwischen denselben Räumen liegen parallel versetzt', async () => {
  const p = await projekt();
  p.flaechen.push({ ...p.flaechen.find((f) => f.id === 'fl-bad-wohnen'), id: 'fl-bad-wohnen2', name: 'Zweite Wand' });
  const g = geometrie(planVon(p));
  const beide = g.linien.filter((l) => l.art === 'wand' && l.raumId === 'raum-bad');
  gleich(beide.length, 2, 0, 'zwei Wandlinien Bad → Wohnzimmer');
  wahr(Math.abs(beide[0].y1 - beide[1].y1) > 5 || Math.abs(beide[0].x1 - beide[1].x1) > 5, 'Anfänge liegen auseinander');
});

// --- Übersichtlichkeit: Marken statt Linien zu den Randsymbolen -------------------------------------

test('Geometrie: ohne Auswahl nur Wände zwischen Räumen, Außenbezüge als Marken im Kasten', async () => {
  const plan = planVon(await projekt());
  const g = geometrie(plan);
  gleich(g.linien.length, 2, 0, 'zwei Wandlinien (Bad↔Wohnzimmer, Flur↔Wohnzimmer)');
  wahr(g.linien.every((l) => l.art === 'wand'), 'nur Wände');
  const wohnen = g.kaesten.find((k) => k.id === 'raum-wohnen');
  wahr(wohnen.marken.map((m) => m.farbe).join(',') === 'aussen,nachbar,erdreich', `Reihenfolge der Marken: ${wohnen.marken.map((m) => m.farbe)}`);
  const flaeche = (farbe) => wohnen.marken.find((m) => m.farbe === farbe).flaeche;
  // Außenluft: Südwand 12,5 m² + Dach 20 m²; Nachbar: Westwand 4 · 2,5 = 10 m²; Erdreich: Bodenplatte 20 m²
  wahr(flaeche('aussen') === 32.5 && flaeche('nachbar') === 10 && flaeche('erdreich') === 20, `Marken: ${JSON.stringify(wohnen.marken)}`);
  const flur = g.kaesten.find((k) => k.id === 'raum-flur');
  wahr(flur.marken.map((m) => m.farbe).join(',') === 'aussen,unbeheizt', 'Flur: Außenluft und unbeheizter Keller');
});

test('Geometrie: „alle Außenlinien“ bündelt je Raum und Gegenseite eine Linie', async () => {
  const g = geometrie(planVon(await projekt()), { bezuege: 'alle' });
  const bezuege = g.linien.filter((l) => l.art === 'bezug');
  // Wohnzimmer: Außenluft (Süd + Dach), Nachbar, Erdreich; Bad: Außenluft (Wand + Dach), Erdreich; Flur: Außenluft (Eingang + Dach), Keller
  gleich(bezuege.length, 7, 0, 'sieben gebündelte Linien statt zehn Einzellinien');
  const sued = bezuege.find((l) => l.id === 'b-raum-wohnen|aussen');
  wahr(sued.flaechenIds.length === 2 && sued.flaechenIds.includes('l-fl-wohnen-aussen') && sued.flaechenIds.includes('l-fl-wohnen-dach'), 'beide Außenflächen in einer Linie');
  wahr(sued.breite > linienBreite(8), 'Stärke folgt der Summe (8,02 + 20 m² netto)');
});

test('Geometrie: Auswahl eines Raums zeigt nur dessen Linien zu den Randsymbolen', async () => {
  const plan = planVon(await projekt());
  const bad = geometrie(plan, { auswahlRaum: 'raum-bad' });
  const aussen = bad.linien.filter((l) => l.art === 'bezug');
  wahr(aussen.length === 2 && aussen.every((l) => l.raumId === 'raum-bad'), 'Bad: Außenluft und Erdreich');
  wahr(bad.kaesten.find((k) => k.id === 'raum-bad').gewaehlt && !bad.kaesten.find((k) => k.id === 'raum-flur').gewaehlt, 'nur das Bad ist gewählt');
  const symbol = geometrie(plan, { auswahlSymbol: 'aussen' });
  const raeume = symbol.linien.filter((l) => l.art === 'bezug').map((l) => l.raumId).sort();
  wahr(raeume.join(',') === 'raum-bad,raum-flur,raum-wohnen', `Außenluft grenzt an: ${raeume}`);
  wahr(symbol.symbole.find((s) => s.id === 'aussen').gewaehlt, 'Symbol gewählt');
});

test('Details: Raumkarte listet alle Flächen mit Gegenseite, U-Wert und Verlust, auch aus dem Nachbarraum geführte Wände', async () => {
  const plan = planVon(await projekt());
  const d = raumDetails(plan, 'raum-wohnen');
  wahr(d.titel === 'Wohnzimmer' && d.kopf === 'Beheizt, 20 °C, 20,0 m², EG', d.kopf);
  gleich(d.zeilen.length, 6, 0, 'vier eigene Flächen und zwei im Nachbarraum geführte Wände');
  wahr(d.zeilen.some((z) => z.includes('Südwand') && z.includes('Außenluft') && z.includes('8,02 m² netto') && z.includes('626 – 750 W')), 'Südwand mit Verlust');
  wahr(d.zeilen.some((z) => z.includes('von „Bad“ geführt') && z.includes('22 – 26 W')), 'Wand vom Bad geführt');
  wahr(raumDetails(plan, 'gibt-es-nicht') === null, 'unbekannter Raum');
  const bad = bezugDetails(plan, ['l-fl-bad-aussen', 'l-fl-bad-dach']);
  wahr(bad.kopf === '2 Flächen, zusammen 10,64 m² netto' && bad.titel === 'Bad → Außenluft', `${bad.titel} / ${bad.kopf}`);
  const luft = symbolDetails(plan, 'aussen');
  wahr(luft.kopf === '3 Räume grenzen an.' && luft.zeilen.length === 3 && luft.zeilen.some((z) => z.startsWith('Wohnzimmer: 2 Flächen')), luft.zeilen.join(' | '));
  wahr(symbolDetails(plan, 'zone:zone-nachbar').kopf === '1 Raum grenzt an.', 'Nachbar: ein Raum');
});

test('Geometrie: bis zu zwölf Räume je Geschoss überlappen sich in der Startanordnung nicht', () => {
  const kaesten = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `Raum ${i}`, position: null, verbunden: [] }));
  const pos = positionenFuerGeschoss(kaesten);
  const liste = [...pos.values()];
  for (let i = 0; i < liste.length; i += 1) {
    for (let j = i + 1; j < liste.length; j += 1) {
      const dx = Math.abs(liste[i].x - liste[j].x) * (FLAECHE_B / 100);
      const dy = Math.abs(liste[i].y - liste[j].y) * (FLAECHE_H / 100);
      wahr(dx >= KASTEN_B || dy >= KASTEN_H, `Platz ${i} und ${j} überlappen nicht`);
    }
  }
});

test('Geometrie: verbundene Räume stehen in der Startanordnung nebeneinander', () => {
  const k = (id, verbunden) => ({ id, name: id, position: null, verbunden });
  // Kette a–b–c–d und ein einzelner Raum e: jedes Kettenglied liegt höchstens ein Feld (auch diagonal) von seinem Partner entfernt.
  const pos = positionenFuerGeschoss([k('e', []), k('a', ['b']), k('b', ['a', 'c']), k('c', ['b', 'd']), k('d', ['c'])]);
  const abstand = (x, y) => Math.hypot((pos.get(x).x - pos.get(y).x) * (FLAECHE_B / 100), (pos.get(x).y - pos.get(y).y) * (FLAECHE_H / 100));
  for (const [x, y] of [['a', 'b'], ['b', 'c'], ['c', 'd']]) {
    wahr(abstand(x, y) < 360, `${x} und ${y} liegen nebeneinander (${Math.round(abstand(x, y))} Einheiten)`);
  }
});

// --- Speicherung und Bericht -------------------------------------------------------------------------

test('Positionen sind im Export enthalten und bleiben beim Import erhalten', async () => {
  const p = await projekt();
  const speicher = pruefeImport(await ladeText()).daten;
  speicher.rooms.find((r) => r.id === 'raum-bad').plan = { x: 12.5, y: 80 };
  const export_ = baueExport(speicher, jetzt);
  gleich(export_.daten.raeume.find((r) => r.id === 'raum-bad').plan.x, 12.5, 0, 'x im Export');
  const zurueck = pruefeImport(JSON.stringify(export_));
  wahr(zurueck.ok, 'Import der Sicherung');
  const bad = zurueck.daten.rooms.find((r) => r.id === 'raum-bad');
  wahr(bad.plan.x === 12.5 && bad.plan.y === 80, 'Position nach dem Import erhalten');
  const plan = baueplan(projektAusSpeicher(zurueck.daten), null);
  wahr(plan.geschosse[0].kaesten.find((k) => k.id === 'raum-bad').position.x === 12.5, 'Plan nutzt die Position');
  wahr(p.raeume.every((r) => r.plan === undefined), 'das Beispielhaus selbst enthält keine Positionen');
});

test('Plan ohne Rechenergebnis (Rechenfehler) zeichnet trotzdem, nur ohne Verlustwerte', async () => {
  const plan = baueplan(await projekt(), null);
  gleich(plan.linien.length, 12, 0, 'Linien');
  wahr(plan.linien.every((l) => l.verlust === null), 'keine Verluste');
});

test('Bericht: eigene Seite „Plan und Vollständigkeit“ mit Plan, Auffälligkeiten und Prüftabelle', async () => {
  const b = baueBericht(await projekt(), jetzt);
  const a = b.abschnitte.find((x) => x.titel.includes('Plan und Vollständigkeit'));
  wahr(a && a.neueSeite === true, 'Abschnitt auf neuer Seite');
  wahr(b.abschnitte.indexOf(a) < b.abschnitte.findIndex((x) => x.titel.includes('Anlage')), 'vor der Anlage');
  wahr(a.bloecke.some((x) => x.art === 'plan' && x.plan.linien.length === 12), 'Planblock mit 12 Linien');
  const tabelle = a.bloecke.find((x) => x.art === 'tabelle');
  gleich(tabelle.zeilen.length, 21, 0, 'Zeilen der Prüftabelle: je Raum sieben Prüfpunkte');
  wahr(tabelle.zeilen.every((z) => z[2] === '✓'), 'im Beispielhaus überall ✓');
  wahr(JSON.stringify(a.bloecke).includes('Keine Auffälligkeiten.'), 'Hinweis ohne Auffälligkeiten');
  const titel = b.abschnitte.map((x) => x.titel);
  wahr(titel.every((t, i) => t.startsWith(`${i + 1} `)), 'Nummerierung bleibt lückenlos');
  const leer = baueBericht({ ...(await projekt()), raeume: [], flaechen: [], heizkoerper: [] }, jetzt);
  wahr(!leer.abschnitte.some((x) => x.titel.includes('Plan')), 'ohne Räume kein Planabschnitt');
});
