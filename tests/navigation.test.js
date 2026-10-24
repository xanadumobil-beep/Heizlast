// Tests für die Navigation: Hauptband, Unterreiter, Merken der letzten Seite, Links.

import { test, wahr } from './runner.js';
import {
  BEREICHE, SEITEN, seitenVon, sichtbarerUnterreiter, ladeNavigation, merkeSeite, zielSeite, seiteAusLink,
} from '../js/navigation.js';

const fakeSpeicher = () => {
  const daten = new Map();
  return { getItem: (k) => daten.get(k) ?? null, setItem: (k, v) => { daten.set(k, v); }, daten };
};

test('Hauptband: acht Punkte in der vorgegebenen Reihenfolge', () => {
  wahr(BEREICHE.map((b) => b.titel).join('|') === 'Ergebnis|Gebäude|Heizkörper|Szenarien|Abgleich|Bericht|Grundlagen|⚙', BEREICHE.map((b) => b.titel).join('|'));
  wahr(BEREICHE.length === 8, 'acht Bereiche');
  wahr(BEREICHE.every((b) => b.symbol && typeof b.kurz === 'string'), 'jeder Punkt hat ein Symbol und einen Kurztext');
});

test('Unterreiter: Gebäude, Grundlagen und ⚙ haben welche, die übrigen Bereiche genau eine Seite', () => {
  const ids = (b) => seitenVon(b).map((s) => s.id).join(',');
  wahr(ids('gebaeude') === 'raeume,plan', ids('gebaeude'));
  wahr(ids('grundlagen') === 'bauteile,oeffnungen,zonen,waermepumpen,rechenannahmen', ids('grundlagen'));
  wahr(ids('system') === 'sicherung,app', ids('system'));
  for (const b of ['ergebnis', 'heizkoerper', 'szenarien', 'abgleich', 'bericht']) {
    wahr(seitenVon(b).length === 1 && !sichtbarerUnterreiter(b), `${b}: eine Seite, kein Unterreiter`);
  }
  wahr(sichtbarerUnterreiter('gebaeude') && sichtbarerUnterreiter('grundlagen') && sichtbarerUnterreiter('system'), 'Unterreiter sichtbar');
  wahr(SEITEN.find((s) => s.id === 'vorlauf').titel === 'Heizkörper & Vorlauf', 'Titel Heizkörper & Vorlauf');
});

test('Jede Seite ist über das Menü erreichbar: Hauptpunkt, dann Unterreiter', () => {
  const speicher = fakeSpeicher();
  const erreicht = new Set();
  for (const b of BEREICHE) {
    // Hauptpunkt öffnet eine Seite des Bereichs, der Unterreiter dieses Bereichs führt zu allen Seiten
    const ziel = SEITEN.find((s) => s.id === zielSeite(speicher, b.id));
    wahr(ziel.bereich === b.id, `${b.id}: Hauptpunkt führt in den eigenen Bereich`);
    for (const s of seitenVon(b.id)) {
      wahr(seiteAusLink(`#${s.id}`, speicher).seite.id === s.id, `${s.id}: Link öffnet die Seite`);
      erreicht.add(s.id);
    }
  }
  const sichtbar = SEITEN.filter((s) => !s.versteckt).map((s) => s.id);
  wahr(sichtbar.every((id) => erreicht.has(id)), `nicht erreichbar: ${sichtbar.filter((id) => !erreicht.has(id))}`);
  wahr(SEITEN.every((s) => BEREICHE.some((b) => b.id === s.bereich)), 'jede Seite gehört zu einem Bereich');
});

test('Merken: Hauptpunkt öffnet die zuletzt gewählte Seite des Bereichs, der Start die zuletzt geöffnete Seite', () => {
  const speicher = fakeSpeicher();
  wahr(zielSeite(speicher, 'grundlagen') === 'bauteile', 'ohne Merken die erste Seite');
  wahr(seiteAusLink('', speicher).seite.id === 'ergebnis', 'ohne Merken Ergebnis');
  merkeSeite(speicher, SEITEN.find((s) => s.id === 'zonen'));
  merkeSeite(speicher, SEITEN.find((s) => s.id === 'plan'));
  wahr(zielSeite(speicher, 'grundlagen') === 'zonen', 'Grundlagen → Zonen');
  wahr(zielSeite(speicher, 'gebaeude') === 'plan', 'Gebäude → Plan');
  wahr(seiteAusLink('', speicher).seite.id === 'plan', 'Start ohne Link: zuletzt geöffnete Seite');
  wahr(seiteAusLink('#bericht', speicher).seite.id === 'bericht', 'ein Link geht vor dem Gemerkten');
  // Das Foto-Vollbild gilt als „Räume“
  merkeSeite(speicher, SEITEN.find((s) => s.id === 'foto'));
  wahr(zielSeite(speicher, 'gebaeude') === 'raeume', 'Foto merkt Räume');
});

test('Merken ohne Speicher oder mit defektem Eintrag: Standard, kein Fehler', () => {
  wahr(zielSeite(null, 'system') === 'sicherung', 'ohne Speicher');
  merkeSeite(null, SEITEN[1]);
  const kaputt = fakeSpeicher();
  kaputt.setItem('heizlast-navigation', '{nicht json');
  wahr(ladeNavigation(kaputt).letzter === null && zielSeite(kaputt, 'gebaeude') === 'raeume', 'defekter Eintrag');
  const unbekannt = fakeSpeicher();
  unbekannt.setItem('heizlast-navigation', JSON.stringify({ letzter: 'gibtsnicht', seiten: { grundlagen: 'gibtsnicht' } }));
  wahr(zielSeite(unbekannt, 'grundlagen') === 'bauteile' && seiteAusLink('', unbekannt).seite.id === 'ergebnis', 'unbekannte Seite');
  const voll = { getItem: () => null, setItem: () => { throw new Error('voll'); } };
  merkeSeite(voll, SEITEN[1]);
});

test('Links: Raumdetail, Foto, alte Einstellungen und Unbekanntes', () => {
  const r = seiteAusLink('#raum/abc', null);
  wahr(r.seite.id === 'raeume' && r.parameter === 'abc', '#raum/<id>');
  const f = seiteAusLink('#foto/f1/m1', null);
  wahr(f.seite.id === 'foto' && f.parameter === 'f1' && f.extra === 'm1' && f.seite.nav === 'raeume', '#foto/<id>/<marke>');
  wahr(seiteAusLink('#einstellungen', null).seite.id === 'rechenannahmen', 'alter Link #einstellungen');
  wahr(seiteAusLink('#szenarien/s1', null).parameter === 's1', '#szenarien/<id>');
  wahr(seiteAusLink('#verbrauch/neu', null).parameter === 'neu', '#verbrauch/neu');
  wahr(seiteAusLink('#gibtsnicht', null).seite.id === 'ergebnis', 'unbekannt → Ergebnis');
});

// Jeder Sprung im Code (href und location.hash) muss auf eine Seite zeigen. Nur in Node, dort liegen die Quelldateien.
test('Alle internen Links im Code führen zu einer Seite', async () => {
  if (typeof process === 'undefined' || !process.versions?.node) return;
  const { readdir, readFile } = await import('node:fs/promises');
  const wurzel = new URL('../js/', import.meta.url);
  const dateien = [];
  const lies = async (ordner) => {
    for (const e of await readdir(ordner, { withFileTypes: true })) {
      if (e.isDirectory()) await lies(new URL(`${e.name}/`, ordner));
      else if (e.name.endsWith('.js')) dateien.push(new URL(e.name, ordner));
    }
  };
  await lies(wurzel);
  const ziele = new Set();
  for (const datei of dateien) {
    const text = await readFile(datei, 'utf8');
    for (const m of text.matchAll(/(?:href: `?'?|location\.hash = `?'?)#([a-z]+)/g)) ziele.add(m[1]);
  }
  wahr(ziele.size >= 8, `zu wenige Links gefunden: ${[...ziele]}`);
  for (const ziel of ziele) {
    const gefunden = ziel === 'raum' ? 'raeume' : ziel === 'einstellungen' ? 'rechenannahmen' : ziel;
    wahr(SEITEN.some((s) => s.id === gefunden), `Link #${ziel} führt zu keiner Seite`);
  }
});
