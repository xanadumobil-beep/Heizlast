// Tests für Fotos, Markierungen, Bauplan-Hintergrund und die Sicherung mit Fotos. Es kommen nur künstlich erzeugte Bytes vor:
// kleine Byte-Folgen mit dem Typ image/jpeg, keine echten Bilder und kein Bauplan.

import { test, wahr, gleich } from './runner.js';
import { pruefeImport, projektAusSpeicher, baueExport, SCHEMA_VERSION } from '../js/io.js';
import {
  zielGroesse, bytesText, oeffnungenDesRaums, heizkoerperDesRaums, flaechenDesRaums, markierungsText, beschriftungFuerZiel, neueMarkierung,
  markierungenFuerZiel, fotoAnhang, sortiereFotos, fotoMeta, datumKurz, begrenzeProzent, FOTO_MAX_SEITE,
} from '../js/foto.js';
import { blobZuBase64, blobZuDataUrl, dataUrlZuBlob, baueExportBlob, dateiFotosZuBlobs, schaetzeExportGroesse } from '../js/fotoexport.js';
import { geometrie, bodenHoehe, klemmePosition, FLAECHE_B, FLAECHE_H, KASTEN_H } from '../js/planlayout.js';
import { baueplan } from '../js/plan.js';
import { rechne } from '../js/daten.js';
import { baueBericht } from '../js/bericht.js';
import * as db from '../js/db.js';

async function ladeText() {
  const adresse = new URL('../examples/beispiel-mini-haus.json', import.meta.url);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(adresse, 'utf8');
  }
  return (await fetch(adresse)).text();
}
const beispielSpeicher = async () => pruefeImport(await ladeText()).daten;
const beispiel = async () => projektAusSpeicher(await beispielSpeicher());
const jetzt = new Date(2026, 9, 24);

// Künstliche „Bilder“: Byte-Folgen, an denen sich Rundreisen prüfen lassen.
const bytes = (n, start = 0) => Uint8Array.from({ length: n }, (_, i) => (start + i * 7) % 256);
const kuenstlichesBild = (n, start) => new Blob([bytes(n, start)], { type: 'image/jpeg' });
const foto = (id, raumId, titel, datum, n = 300) => ({
  id, raumId, titel, notiz: `Notiz ${titel}`, datum, breite: 2048, hoehe: 1365, blob: kuenstlichesBild(n, 1), vorschau: kuenstlichesBild(40, 5), groesse: n + 40,
});

// --- Verkleinern --------------------------------------------------------------------------------------

// Lange Seite höchstens 2048 px, Seitenverhältnis bleibt, nie vergrößern:
//   4032 × 3024 → Faktor 2048/4032 = 0,5079 → 2048 × 1536;  3024 × 4032 (Hochformat) → 1536 × 2048;  1000 × 800 bleibt
test('Verkleinern: lange Seite höchstens 2048 px, Seitenverhältnis bleibt, nie vergrößern', () => {
  const a = zielGroesse(4032, 3024);
  wahr(a.breite === 2048 && a.hoehe === 1536, `${a.breite} × ${a.hoehe}`);
  const b = zielGroesse(3024, 4032);
  wahr(b.breite === 1536 && b.hoehe === 2048, `${b.breite} × ${b.hoehe}`);
  const c = zielGroesse(1000, 800);
  wahr(c.breite === 1000 && c.hoehe === 800 && c.faktor === 1, 'kleine Bilder bleiben');
  wahr(zielGroesse(8000, 10).hoehe === 3 && zielGroesse(8000, 10).breite === 2048, 'sehr schmal: mindestens 1 px');
  const d = zielGroesse(3000, 2000, 400);
  wahr(d.breite === 400 && d.hoehe === 267, `Vorschau ${d.breite} × ${d.hoehe}`);
  wahr(FOTO_MAX_SEITE === 2048 && zielGroesse(0, 0).breite === 0, 'Randfälle');
  wahr(bytesText(512) === '1 KB' || bytesText(512) === '0 KB' || bytesText(512).endsWith('KB'), bytesText(512));
  wahr(bytesText(5 * 1024 * 1024) === '5,0 MB' && bytesText(1536 * 1024) === '1,5 MB', `${bytesText(5 * 1024 * 1024)} / ${bytesText(1536 * 1024)}`);
});

// --- Beschriftung und Verknüpfung --------------------------------------------------------------------------

test('Beschriftung aus der Verknüpfung: Fenster F1, Heizkörper HK1 mit Typ, Flächen Fl1', async () => {
  const p = await beispiel();
  const f = oeffnungenDesRaums(p, 'raum-wohnen');
  wahr(f.length === 1 && f[0].text === 'F1 Fenster Süd' && f[0].id === 'oe-wohnen-fenster', JSON.stringify(f));
  const flur = oeffnungenDesRaums(p, 'raum-flur');
  wahr(flur[0].text === 'T1 Haustür', 'Tür zählt als T1');
  const hk = heizkoerperDesRaums(p, 'raum-wohnen');
  wahr(hk.map((h) => h.text).join('|') === 'HK1 Typ 22|HK2 Gliederheizkörper|HK3 Wärmepumpen-Heizkörper mit Lüfter', hk.map((h) => h.text).join('|'));
  const fl = flaechenDesRaums(p, 'raum-bad');
  wahr(fl[0].text === 'Fl1 Außenwand' && fl.length === 4, 'Bad hat vier Flächen');
  wahr(beschriftungFuerZiel(p, 'raum-wohnen', { art: 'heizkoerper', id: 'hk-wohnen-platte' }) === 'HK1 Typ 22', 'Text für das Speichern');
  wahr(beschriftungFuerZiel(p, 'raum-wohnen', null) === '', 'ohne Ziel leer');
});

test('Markierung: Beschriftung folgt der Verknüpfung, ist änderbar, und fehlt das Ziel, bleibt sie mit Hinweis erhalten', async () => {
  const p = await beispiel();
  const m = { ...neueMarkierung('m1', { id: 'f1', raumId: 'raum-wohnen' }, 40.123, 55), ziel: { art: 'heizkoerper', id: 'hk-wohnen-platte' }, beschriftung: 'HK1 Typ 22', auto: true };
  wahr(m.x === 40.12 && m.y === 55 && m.raumId === 'raum-wohnen' && m.auto === true, 'Position in Prozent auf zwei Stellen');
  let t = markierungsText(p, m);
  wahr(t.text === 'HK1 Typ 22' && !t.fehlt && t.verknuepft, JSON.stringify(t));
  // Das erste Heizkörper-Kürzel ändert sich, wenn ein anderer Heizkörper davor gelöscht wird: auto-Text folgt
  const ohneErsten = { ...p, heizkoerper: p.heizkoerper.filter((h) => h.id !== 'hk-wohnen-platte') };
  t = markierungsText(ohneErsten, m);
  wahr(t.fehlt === true && t.text === 'HK1 Typ 22', `gelöscht: Text bleibt, Hinweis: ${JSON.stringify(t)}`);
  const andere = { ...m, ziel: { art: 'heizkoerper', id: 'hk-wohnen-wp' }, beschriftung: 'HK3 Wärmepumpen-Heizkörper mit Lüfter' };
  const ohneZwei = { ...p, heizkoerper: p.heizkoerper.filter((h) => h.id !== 'hk-wohnen-glieder') };
  wahr(markierungsText(ohneZwei, andere).text === 'HK2 Wärmepumpen-Heizkörper mit Lüfter', 'automatische Beschriftung zählt neu');
  const eigen = { ...m, auto: false, beschriftung: 'Ventil klemmt' };
  wahr(markierungsText(p, eigen).text === 'Ventil klemmt' && !markierungsText(p, eigen).fehlt, 'eigener Text bleibt');
  const frei = { ...m, ziel: null, beschriftung: 'Fensterbank beschädigt', auto: false };
  wahr(markierungsText(p, frei).text === 'Fensterbank beschädigt' && !markierungsText(p, frei).fehlt && !markierungsText(p, frei).verknuepft, 'frei beschriftet');
  const fenster = { ...m, ziel: { art: 'oeffnung', id: 'oe-wohnen-fenster' }, beschriftung: 'F1 Fenster Süd' };
  wahr(!markierungsText({ ...p, flaechen: p.flaechen.map((f) => ({ ...f, oeffnungen: [] })) }, fenster).verknuepft === false && markierungsText({ ...p, flaechen: p.flaechen.map((f) => ({ ...f, oeffnungen: [] })) }, fenster).fehlt, 'gelöschte Öffnung: Verknüpfung fehlt');
  const flaeche = { ...m, ziel: { art: 'flaeche', id: 'fl-wohnen-dach' }, beschriftung: 'Fl3 Flachdach' };
  wahr(markierungsText({ ...p, flaechen: p.flaechen.filter((f) => f.id !== 'fl-wohnen-dach') }, flaeche).fehlt, 'gelöschte Fläche: Verknüpfung fehlt');
  wahr(begrenzeProzent(-5) === 0 && begrenzeProzent(130) === 100, 'Prozentwerte werden begrenzt');
});

test('Umgekehrt: Markierungen je Heizkörper, Öffnung und Fläche mit Foto, nach Datum sortiert', () => {
  const fotos = [foto('f1', 'r', 'Spätes Foto', '2026-05-02'), foto('f2', 'r', 'Frühes Foto', '2026-01-10')];
  const markierungen = [
    { id: 'a', fotoId: 'f1', ziel: { art: 'heizkoerper', id: 'h1' } },
    { id: 'b', fotoId: 'f2', ziel: { art: 'heizkoerper', id: 'h1' } },
    { id: 'c', fotoId: 'f2', ziel: { art: 'oeffnung', id: 'o1' } },
    { id: 'd', fotoId: 'f2', ziel: null },
    { id: 'e', fotoId: 'weg', ziel: { art: 'heizkoerper', id: 'h1' } },
  ];
  const h1 = markierungenFuerZiel(markierungen, fotos.map(fotoMeta), 'heizkoerper', 'h1');
  wahr(h1.map((x) => x.foto.titel).join() === 'Frühes Foto,Spätes Foto', 'zwei Fotos, frühestes zuerst, Markierung ohne Foto ignoriert');
  wahr(markierungenFuerZiel(markierungen, fotos, 'oeffnung', 'o1').length === 1 && markierungenFuerZiel(markierungen, fotos, 'flaeche', 'x').length === 0, 'Öffnung und leere Fläche');
  wahr(!('blob' in fotoMeta(fotos[0])) && fotoMeta(fotos[0]).titel === 'Spätes Foto', 'fotoMeta entfernt die Bilddaten');
  wahr(sortiereFotos(fotos)[0].id === 'f2' && datumKurz('2026-01-10T12:00:00.000Z').endsWith('.2026'), 'Sortierung und Datum');
});

test('Fotoanhang für den Bericht: ein Foto je Raum (das erste oder das gewählte) mit nummerierten Markierungen', async () => {
  const p = await beispiel();
  const fotos = [foto('f1', 'raum-bad', 'Bad 1', '2026-02-01'), foto('f2', 'raum-bad', 'Bad 2', '2026-03-01'), foto('f3', 'raum-wohnen', 'Wohnen', '2026-01-01')];
  const markierungen = [
    { id: 'm1', fotoId: 'f1', raumId: 'raum-bad', x: 10, y: 20, ziel: { art: 'heizkoerper', id: 'hk-bad-handtuch' }, beschriftung: 'HK1 Handtuchheizkörper', auto: true },
    { id: 'm2', fotoId: 'f1', raumId: 'raum-bad', x: 50, y: 60, ziel: { art: 'oeffnung', id: 'weg' }, beschriftung: 'F9 Altes Fenster', auto: true },
    { id: 'm3', fotoId: 'f2', raumId: 'raum-bad', x: 5, y: 5, ziel: null, beschriftung: 'Anderes Foto', auto: false },
  ];
  const standard = fotoAnhang(p, fotos.map(fotoMeta), markierungen);
  wahr(standard.length === 2 && standard[0].raumName === 'Bad' && standard[0].fotoId === 'f1', 'Bad: das erste Foto');
  wahr(standard[0].markierungen.length === 2 && standard[0].markierungen[0].nr === 1 && standard[0].markierungen[0].text === 'HK1 Handtuchheizkörper', 'Markierungen nummeriert');
  wahr(standard[0].markierungen[1].fehlt === true && standard[0].markierungen[1].text === 'F9 Altes Fenster', 'fehlende Verknüpfung markiert');
  wahr(standard[1].raumName === 'Wohnzimmer' && standard[1].markierungen.length === 0, 'Wohnzimmer ohne Markierungen');
  const gewaehlt = fotoAnhang(p, fotos.map(fotoMeta), markierungen, { 'raum-bad': 'f2' });
  wahr(gewaehlt[0].fotoId === 'f2' && gewaehlt[0].markierungen.length === 1 && gewaehlt[0].markierungen[0].text === 'Anderes Foto', 'gewähltes Foto');
  wahr(fotoAnhang(p, [], []).length === 0, 'ohne Fotos kein Anhang');
  const b = baueBericht(p, jetzt, { fotoAnhang: standard });
  const abschnitt = b.abschnitte.find((a) => a.titel.includes('Anhang: Fotos'));
  wahr(abschnitt?.neueSeite === true && abschnitt.bloecke.some((x) => x.art === 'fotos' && x.eintraege.length === 2), 'Anhang als eigene Seite');
  wahr(b.abschnitte[b.abschnitte.length - 1] === abschnitt && b.abschnitte.every((a, i) => a.titel.startsWith(`${i + 1} `)), 'Anhang steht zuletzt, Nummerierung bleibt');
  wahr(!baueBericht(p, jetzt).abschnitte.some((a) => a.titel.includes('Anhang')), 'ohne Auswahl kein Anhang');
  wahr(!JSON.stringify(b).includes('blob'), 'keine Bilddaten im Berichtsinhalt');
});

// --- Sicherungsdatei mit und ohne Fotos ------------------------------------------------------------------

test('Base64 und data-URL: Rundreise bytegenau, auch für Blöcke über 32 KB', async () => {
  const blob = kuenstlichesBild(100000, 3);
  const url = await blobZuDataUrl(blob);
  wahr(url.startsWith('data:image/jpeg;base64,'), 'Kopf der data-URL');
  const zurueck = dataUrlZuBlob(url);
  const a = new Uint8Array(await blob.arrayBuffer());
  const b = new Uint8Array(await zurueck.arrayBuffer());
  wahr(zurueck.type === 'image/jpeg' && a.length === b.length && a.every((x, i) => x === b[i]), 'gleiche Bytes');
  wahr(dataUrlZuBlob('kein bild') === null && dataUrlZuBlob(undefined) === null && dataUrlZuBlob('data:image/jpeg;base64,@@@') === null, 'ungültige Werte ergeben null');
  wahr((await blobZuBase64(new Blob([Uint8Array.from([72, 101, 105])]))) === 'SGVp', 'Base64 von „Hei“');
});

test('Sicherung ohne Fotos: keine Fotos, Markierungen und Baupläne in der Datei, Version 3', async () => {
  const speicher = await beispielSpeicher();
  speicher.photos = [foto('f1', 'raum-bad', 'Bad', '2026-01-01')];
  speicher.markers = [{ id: 'm1', fotoId: 'f1', raumId: 'raum-bad', x: 1, y: 2, ziel: null, beschriftung: 'x', auto: false }];
  speicher.backgrounds = [{ id: 'bg-EG', geschoss: 'EG', blob: kuenstlichesBild(50, 2), breite: 1000, hoehe: 700, drehung: 0, deckkraft: 0.5, sichtbar: true }];
  const datei = baueExport(speicher, jetzt);
  wahr(datei.schemaVersion === 3 && SCHEMA_VERSION === 3, 'schemaVersion 3');
  wahr(datei.daten.fotos.length === 0 && datei.daten.markierungen.length === 0 && datei.daten.hintergruende.length === 0, 'ohne Fotos');
  const text = await (await baueExportBlob(speicher, jetzt, { mitFotos: false })).text();
  wahr(JSON.parse(text).daten.fotos.length === 0 && !text.includes('base64'), 'Blob ohne Bilddaten');
});

test('Sicherung mit Fotos: Bilder, Vorschauen, Markierungen und Baupläne überstehen Export und Import bytegenau', async () => {
  const speicher = await beispielSpeicher();
  speicher.photos = [foto('f1', 'raum-bad', 'Bad', '2026-01-01', 5000), foto('f2', 'raum-wohnen', 'Wohnen', '2026-02-01', 70000)];
  speicher.markers = [{ id: 'm1', fotoId: 'f1', raumId: 'raum-bad', x: 12.5, y: 80, ziel: { art: 'heizkoerper', id: 'hk-bad-handtuch' }, beschriftung: 'HK1 Handtuchheizkörper', auto: true }];
  speicher.backgrounds = [{ id: 'bg-EG', geschoss: 'EG', blob: kuenstlichesBild(900, 9), breite: 1200, hoehe: 800, drehung: 90, deckkraft: 0.4, sichtbar: false, groesse: 900 }];
  const schritte = [];
  const blob = await baueExportBlob(speicher, jetzt, { mitFotos: true, fortschritt: (i, n) => schritte.push([i, n]) });
  wahr(schritte.length === 3 && schritte[2][0] === 3 && schritte[2][1] === 3, `Fortschritt: ${JSON.stringify(schritte)}`);
  const text = await blob.text();
  const datei = JSON.parse(text);
  wahr(datei.schemaVersion === 3 && datei.daten.fotos.length === 2 && datei.daten.hintergruende.length === 1 && datei.daten.markierungen.length === 1, 'Inhalt der Datei');
  wahr(datei.daten.fotos[0].bild.startsWith('data:image/jpeg;base64,') && datei.daten.fotos[0].titel === 'Bad' && datei.daten.fotos[0].notiz === 'Notiz Bad', 'Foto mit Bild und Angaben');
  wahr(!('blob' in datei.daten.fotos[0]) && datei.daten.hintergruende[0].drehung === 90, 'keine Blobs, Drehung steht in der Datei');
  wahr(!text.includes('@@FOTOS@@') && !text.includes('@@HINTERGRUENDE@@'), 'Platzhalter ersetzt');

  const pruefung = pruefeImport(text);
  wahr(pruefung.ok && pruefung.zusammenfassung.fotos === 2 && pruefung.zusammenfassung.markierungen === 1 && pruefung.zusammenfassung.hintergruende === 1, 'Import erkennt Fotos');
  wahr(pruefung.fotoInfo.fotos === 2 && pruefung.fotoInfo.hintergruende === 1 && pruefung.fotoInfo.bytes > 70000, `fotoInfo: ${JSON.stringify(pruefung.fotoInfo)}`);
  const { speicher: neu, ausgelassen } = dateiFotosZuBlobs(pruefung.daten);
  wahr(ausgelassen === 0 && neu.photos.length === 2, 'beide Fotos umgewandelt');
  const f2 = neu.photos.find((f) => f.id === 'f2');
  const original = new Uint8Array(await speicher.photos[1].blob.arrayBuffer());
  const gelesen = new Uint8Array(await f2.blob.arrayBuffer());
  wahr(f2.blob.type === 'image/jpeg' && original.every((x, i) => x === gelesen[i]) && original.length === gelesen.length, 'Bild bytegenau');
  wahr(f2.vorschau.size === 40 && f2.groesse === 70040 && f2.raumId === 'raum-wohnen' && f2.titel === 'Wohnen' && f2.breite === 2048, 'Vorschau, Größe und Angaben');
  const bg = neu.backgrounds[0];
  wahr(bg.geschoss === 'EG' && bg.drehung === 90 && bg.deckkraft === 0.4 && bg.sichtbar === false && bg.blob.size === 900, 'Bauplan mit Drehung, Deckkraft und Sichtbarkeit');
  wahr(neu.markers.length === 1 && neu.markers[0].x === 12.5 && neu.markers[0].ziel.id === 'hk-bad-handtuch', 'Markierung bleibt');
  wahr(neu.rooms.length === 3, 'übrige Daten unverändert');
});

test('Import: Fotos ohne Bilddaten werden gemeldet und ausgelassen, ungültige Bauplan-Werte werden bereinigt, ältere Versionen bleiben lesbar', async () => {
  const datei = JSON.parse(await ladeText());
  datei.schemaVersion = 3;
  datei.daten.fotos = [
    { id: 'a', raumId: 'raum-bad', titel: 'ohne Bild', datum: '2026-01-01' },
    { id: 'b', raumId: 'gibtsnicht', titel: 'ohne Raum', bild: 'data:image/jpeg;base64,AAAA', datum: '2026-01-01' },
    { id: 'c', raumId: 'raum-bad', titel: 'kaputt', bild: 'data:image/jpeg;base64,@@@@', datum: '2026-01-01' },
  ];
  datei.daten.markierungen = [{ id: 'm', fotoId: 'weg', raumId: 'raum-bad', x: 1, y: 1, ziel: null, beschriftung: '', auto: true }];
  datei.daten.hintergruende = [{ id: 'bg-EG', geschoss: 'EG', bild: 'data:image/jpeg;base64,AAAA', drehung: 45, deckkraft: 7, sichtbar: true, breite: 10, hoehe: 10 }, { id: 'bg-Keller', geschoss: 'Keller' }];
  const r = pruefeImport(JSON.stringify(datei));
  wahr(r.ok && r.daten.photos.length === 2, 'zwei Fotos mit Bilddaten bleiben');
  const hinweise = r.verweise.join(' | ');
  wahr(hinweise.includes('1 Foto(s) ohne Bilddaten') && hinweise.includes('ohne Raum') && hinweise.includes('1 Markierung(en)') && hinweise.includes('Bauplan/Baupläne ohne Bilddaten'), hinweise);
  const { speicher, ausgelassen } = dateiFotosZuBlobs(r.daten);
  wahr(ausgelassen === 1 && speicher.photos.length === 1 && speicher.photos[0].id === 'b', 'unlesbare Bilddaten werden ausgelassen');
  wahr(speicher.backgrounds[0].drehung === 0 && speicher.backgrounds[0].deckkraft === 1, `Drehung 45 → 0, Deckkraft 7 → 1: ${speicher.backgrounds[0].drehung}, ${speicher.backgrounds[0].deckkraft}`);
  const alt = JSON.parse(await ladeText());
  wahr(pruefeImport(JSON.stringify(alt)).ok && pruefeImport(JSON.stringify({ ...alt, schemaVersion: 2 })).ok, 'Versionen 1 und 2 bleiben lesbar');
  const zukunft = pruefeImport(JSON.stringify({ ...alt, schemaVersion: 4 }));
  wahr(!zukunft.ok && zukunft.fehler[0].includes('Version 3'), 'Version 4 wird abgelehnt');
});

test('Größenanzeige vorab: Datei mit Fotos ist rund ein Drittel größer als die Bilddaten plus die Datei ohne Fotos', async () => {
  const speicher = await beispielSpeicher();
  speicher.photos = [foto('f1', 'raum-bad', 'Bad', '2026-01-01', 30000)];
  speicher.markers = [];
  speicher.backgrounds = [];
  const g = schaetzeExportGroesse(speicher, jetzt);
  gleich(g.fotos, 1, 0, 'Fotos');
  gleich(g.bildBytes, 30040, 0, 'Bild und Vorschau');
  wahr(g.mit > g.ohne + 40000 && g.mit < g.ohne + 45000, `ohne ${g.ohne}, mit ${g.mit}`);
  const echt = (await baueExportBlob(speicher, jetzt, { mitFotos: true })).size;
  wahr(Math.abs(echt - g.mit) / echt < 0.05, `Schätzung ${g.mit} nah an der echten Größe ${echt}`);
});

// --- Bauplan als Hintergrund --------------------------------------------------------------------------

// Bauplan 2000 × 1000 px: Zeichenfläche 780 breit, Höhe 780 · 1000 / 2000 = 390.
// Um 90° gedreht (Hochformat 1000 × 2000): Höhe 780 · 2000 / 1000 = 1560, begrenzt auf 1400.
test('Bauplan: Die Zeichenfläche nimmt das Seitenverhältnis des (gedrehten) Bildes an', () => {
  gleich(bodenHoehe(null), FLAECHE_H, 0, 'ohne Bauplan die feste Höhe');
  gleich(bodenHoehe({ breite: 2000, hoehe: 1000, drehung: 0 }), 390, 0, '2:1 quer');
  gleich(bodenHoehe({ breite: 2000, hoehe: 1000, drehung: 90 }), 1400, 0, 'gedreht: begrenzt auf 1400');
  gleich(bodenHoehe({ breite: 1000, hoehe: 1000, drehung: 0 }), 780, 0, 'quadratisch');
  gleich(bodenHoehe({ breite: 4000, hoehe: 400, drehung: 180 }), 240, 0, 'sehr flach: mindestens 240');
  wahr(bodenHoehe({ breite: 0, hoehe: 0, drehung: 0 }) === FLAECHE_H, 'ungültiges Bild: feste Höhe');
});

test('Bauplan: Prozent-Positionen der Kästen bleiben gültig, die Pixelposition folgt der neuen Höhe', async () => {
  const p = await beispiel();
  p.raeume.find((r) => r.id === 'raum-bad').plan = { x: 25, y: 50 };
  const plan = baueplan(p, rechne(p).ergebnis);
  const ohne = geometrie(plan);
  const mit = geometrie(plan, { hintergruende: new Map([['EG', { geschoss: 'EG', breite: 2000, hoehe: 1000, drehung: 0, deckkraft: 0.5, sichtbar: true }]]) });
  const bad = (g) => g.kaesten.find((k) => k.id === 'raum-bad');
  wahr(bad(ohne).prozent.x === 25 && bad(ohne).prozent.y === 50 && bad(mit).prozent.x === 25 && bad(mit).prozent.y === 50, 'Prozentwerte unverändert');
  wahr(mit.boeden[0].h === 390 && ohne.boeden[0].h === FLAECHE_H, 'Höhe des Geschosses');
  gleich(bad(mit).cy, mit.boeden[0].y + 0.5 * 390, 1e-9, 'Mittelpunkt bei 50 % der neuen Höhe');
  gleich(bad(mit).cx, 0.25 * FLAECHE_B, 1e-9, 'x bei 25 %');
  wahr(mit.boeden[0].hintergrund?.drehung === 0 && ohne.boeden[0].hintergrund === null, 'Bauplan hängt am Geschoss');
  const ausgeblendet = geometrie(plan, { hintergruende: new Map([['EG', { breite: 2000, hoehe: 1000, drehung: 0, deckkraft: 0.5, sichtbar: false }]]) });
  wahr(ausgeblendet.boeden[0].h === 390, 'ausgeblendet: Form bleibt, damit die Kästen nicht springen');
  // Klemmen in der neuen Höhe: ein Kasten ist 104 hoch → mindestens 52 / 390 = 13,3 %
  const k = klemmePosition({ x: 50, y: 0 }, 390);
  wahr(Math.abs(k.y - Math.round((KASTEN_H / 2 / 390) * 1000) / 10) < 0.11, `y geklemmt auf ${k.y}`);
});

// --- Schreibschutz und Speicher --------------------------------------------------------------------------------

test('Schreibschutz im Szenario-Betrieb: Fotos und Markierungen sind Bestandsdaten, Baupläne nicht', async () => {
  db.setzeSchreibschutz(true);
  try {
    for (const store of ['photos', 'markers']) {
      let fehler = null;
      try { await db.speichere(store, { id: 'x' }); } catch (e) { fehler = e; }
      wahr(fehler instanceof db.SchreibschutzFehler, `${store} gesperrt`);
    }
    wahr(!db.FOTO_STORES.includes('scenarios') && db.FOTO_STORES.join() === 'photos,markers,backgrounds', 'Foto-Speicher');
    wahr(db.STORES.includes('backgrounds') && db.DATEN_STORES.includes('backgrounds'), 'Speicher für Baupläne vorhanden');
  } finally {
    db.setzeSchreibschutz(false);
  }
});
