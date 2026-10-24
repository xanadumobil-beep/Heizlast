// Aufbau der Navigation: Hauptband (acht Bereiche), Seiten je Bereich (Unterreiter) und die Merkfunktion.
// Reine Funktionen ohne Oberflächenbezug, damit sich die Struktur testen lässt. Gezeichnet wird in app.js.

// Hauptband in dieser Reihenfolge. symbol und kurz erscheinen auf schmalen Bildschirmen (iPhone).
export const BEREICHE = [
  { id: 'ergebnis', titel: 'Ergebnis', kurz: 'Ergeb.', symbol: '📊' },
  { id: 'gebaeude', titel: 'Gebäude', kurz: 'Haus', symbol: '🏠' },
  { id: 'heizkoerper', titel: 'Heizkörper', kurz: 'Heiz.', symbol: '♨️' },
  { id: 'szenarien', titel: 'Szenarien', kurz: 'Szen.', symbol: '🔀' },
  { id: 'abgleich', titel: 'Abgleich', kurz: 'Abgl.', symbol: '⚖️' },
  { id: 'bericht', titel: 'Bericht', kurz: 'Bericht', symbol: '📄' },
  { id: 'grundlagen', titel: 'Grundlagen', kurz: 'Basis', symbol: '🧱' },
  { id: 'system', titel: '⚙', kurz: '', symbol: '⚙️', beschriftung: 'Sicherung und App' },
];

// Seiten. Die Kennung ist der Teil nach # im Link. versteckt: steht nicht im Unterreiter, nav: Seite, die dort als gewählt gilt.
export const SEITEN = [
  { id: 'ergebnis', bereich: 'ergebnis', titel: 'Ergebnis' },
  { id: 'raeume', bereich: 'gebaeude', titel: 'Räume' },
  { id: 'plan', bereich: 'gebaeude', titel: 'Plan' },
  { id: 'vorlauf', bereich: 'heizkoerper', titel: 'Heizkörper & Vorlauf' },
  { id: 'szenarien', bereich: 'szenarien', titel: 'Szenarien' },
  { id: 'verbrauch', bereich: 'abgleich', titel: 'Verbrauchsabgleich' },
  { id: 'bericht', bereich: 'bericht', titel: 'Bericht' },
  { id: 'bauteile', bereich: 'grundlagen', titel: 'Bauteile' },
  { id: 'oeffnungen', bereich: 'grundlagen', titel: 'Öffnungen' },
  { id: 'zonen', bereich: 'grundlagen', titel: 'Zonen' },
  { id: 'waermepumpen', bereich: 'grundlagen', titel: 'Wärmepumpen' },
  { id: 'rechenannahmen', bereich: 'grundlagen', titel: 'Rechenannahmen' },
  { id: 'sicherung', bereich: 'system', titel: 'Sicherung' },
  { id: 'app', bereich: 'system', titel: 'App' },
  // Vollbild eines Fotos: #foto/<Foto>/<Markierung>. Gehört zu „Räume“.
  { id: 'foto', bereich: 'gebaeude', titel: 'Foto', versteckt: true, nav: 'raeume' },
];

export const seitenVon = (bereichId) => SEITEN.filter((s) => s.bereich === bereichId && !s.versteckt);
export const sichtbarerUnterreiter = (bereichId) => seitenVon(bereichId).length >= 2;

const NAV_SCHLUESSEL = 'heizlast-navigation';

// Zuletzt geöffnete Seite je Bereich und zuletzt geöffnete Seite insgesamt. speicher: localStorage oder etwas mit getItem/setItem.
// Ohne Speicher oder mit defektem Eintrag gilt der Standard.
export function ladeNavigation(speicher) {
  try {
    const roh = JSON.parse(speicher?.getItem(NAV_SCHLUESSEL) ?? 'null');
    if (roh && typeof roh === 'object') {
      return { letzter: typeof roh.letzter === 'string' ? roh.letzter : null, seiten: roh.seiten && typeof roh.seiten === 'object' ? roh.seiten : {} };
    }
  } catch { /* Standard */ }
  return { letzter: null, seiten: {} };
}

export function merkeSeite(speicher, seite) {
  const nav = ladeNavigation(speicher);
  const id = seite.nav ?? seite.id;
  nav.letzter = id;
  nav.seiten[seite.bereich] = id;
  try { speicher?.setItem(NAV_SCHLUESSEL, JSON.stringify(nav)); } catch { /* nicht schlimm */ }
}

// Seite, die ein Hauptpunkt öffnet: die zuletzt dort geöffnete, sonst die erste des Bereichs.
export function zielSeite(speicher, bereichId) {
  const seiten = seitenVon(bereichId);
  const gemerkt = ladeNavigation(speicher).seiten[bereichId];
  return (seiten.find((s) => s.id === gemerkt) ?? seiten[0]).id;
}

// Link (Teil nach #) → { seite, parameter, extra }. Ältere Links bleiben gültig: #raum/<id> gehört zu Räumen,
// #einstellungen heißt jetzt Rechenannahmen. Ohne gültigen Link öffnet sich die zuletzt geöffnete Seite, sonst Ergebnis.
export function seiteAusLink(hash, speicher) {
  const [erster, parameter, extra] = String(hash ?? '').replace(/^#/, '').split('/');
  const id = erster === 'raum' ? 'raeume' : erster === 'einstellungen' ? 'rechenannahmen' : erster;
  const gefunden = SEITEN.find((s) => s.id === id);
  const gemerkt = SEITEN.find((s) => s.id === ladeNavigation(speicher).letzter && !s.versteckt);
  return { seite: gefunden ?? gemerkt ?? SEITEN[0], parameter, extra };
}
