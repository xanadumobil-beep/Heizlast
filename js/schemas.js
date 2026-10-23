// Auswahllisten, Standardwerte und Feldbeschreibungen für die Eingabemasken.
// Die Feldlisten steuern die Formulare, die Validierung steht in validate.js.

import { zahlZuText } from './engine/format.js';

export const BAUTEILARTEN = [
  { wert: 'aussenwand', label: 'Außenwand' },
  { wert: 'dach', label: 'Dach' },
  { wert: 'kellerdecke', label: 'Kellerdecke' },
  { wert: 'bodenplatte', label: 'Bodenplatte' },
  { wert: 'erdberuehrteWand', label: 'Erdberührte Wand' },
  { wert: 'nachbarwand', label: 'Nachbarwand' },
  { wert: 'innenwand', label: 'Innenwand' },
  { wert: 'innendecke', label: 'Innendecke' },
];

export const QUELLEN = [
  { wert: 'rechnung', label: 'Rechnung' },
  { wert: 'stempel', label: 'Stempel' },
  { wert: 'schaetzung', label: 'Schätzung aus Bauplan' },
];

// Außenluft ist keine Zone: sie hängt an der Normaußentemperatur in den Einstellungen.
// Passiv beheizte Räume sind ebenfalls keine Zone, sie sind Räume mit Status "passiv".
export const ZONENARTEN = [
  { wert: 'erdreich', label: 'Erdreich' },
  { wert: 'unbeheizt', label: 'Unbeheizter Raum (z. B. Keller)' },
  { wert: 'nachbar', label: 'Nachbargebäude' },
];

export const OEFFNUNGSARTEN = [
  { wert: 'fenster', label: 'Fenster' },
  { wert: 'tuer', label: 'Tür' },
];

export const GESCHOSSE = [
  { wert: 'EG', label: 'EG' },
  { wert: 'Keller', label: 'Keller' },
];

export const STATI = [
  { wert: 'beheizt', label: 'Beheizt' },
  { wert: 'passiv', label: 'Passiv mitbeheizt' },
  { wert: 'unbeheizt', label: 'Unbeheizt (wird nicht gerechnet)' },
];

export const MASSARTEN_FLAECHE = [
  { wert: 'laengeHoehe', label: 'Länge × Höhe' },
  { wert: 'flaeche', label: 'Fläche direkt' },
];

export const MASSARTEN_OEFFNUNG = [
  { wert: 'laengeHoehe', label: 'Breite × Höhe' },
  { wert: 'flaeche', label: 'Fläche direkt' },
];

export const werte = (liste) => liste.map((o) => o.wert);
export const label = (liste, wert) => liste.find((o) => o.wert === wert)?.label ?? '–';

export function standardEinstellungen() {
  return {
    id: 'projekt',
    projektname: '',
    thetaAussen: -8,
    luftwechselStandard: { min: 0.5, max: 1 },
    dUWB: { min: 0.05, max: 0.15 },
    fg: 1,
    aufheizzuschlag: { aktiv: false, wProM2: 0 },
    spreizung: 5,
    heizkoerperExponent: 1.3,
  };
}

export function standardZonen() {
  return [{ id: 'zone-erdreich', name: 'Erdreich', art: 'erdreich', temperatur: { min: 8, max: 12 }, notiz: '' }];
}

export const EINSTELLUNGEN_FELDER = [
  { key: 'projektname', label: 'Projektname', typ: 'text', hinweis: 'Optional, erscheint im Bericht.' },
  {
    key: 'thetaAussen', label: 'Normaußentemperatur', typ: 'zahl', einheit: '°C',
    hinweis: 'Gilt für beide Rechnungen (günstig und ungünstig) unverändert.',
  },
  {
    key: 'luftwechselStandard', label: 'Standard-Luftwechsel', typ: 'bereich', einheit: '1/h',
    hinweis: 'Gilt für Räume ohne eigenen Wert. Das Minimum geht in die günstige, das Maximum in die ungünstige Rechnung ein.',
  },
  {
    key: 'dUWB', label: 'Wärmebrückenzuschlag ΔU_WB', typ: 'bereich', einheit: 'W/(m²K)',
    hinweis: 'Wird nur auf Bauteile der Gebäudehülle angewendet (Außenluft, Erdreich, unbeheizte Zonen, Nachbar).',
  },
  {
    key: 'fg', label: 'Erdreich-Korrekturfaktor f_g', typ: 'zahl',
    hinweis: 'Wird auf Verluste ins Erdreich angewendet. Die Erdreichtemperatur steht bei den Zonen.',
  },
  { key: 'aufheizzuschlag.aktiv', label: 'Aufheizzuschlag verwenden', typ: 'schalter' },
  { key: 'aufheizzuschlag.wProM2', label: 'Aufheizzuschlag', typ: 'zahl', einheit: 'W/m²', hinweis: 'Bezogen auf die Raumfläche.' },
  { key: 'spreizung', label: 'Spreizung Vor-/Rücklauf', typ: 'zahl', einheit: 'K' },
  { key: 'heizkoerperExponent', label: 'Heizkörperexponent n (Standard)', typ: 'zahl', hinweis: 'Gilt für Heizkörper ohne eigenen Wert.' },
];

export const ZONEN_FELDER = [
  { key: 'name', label: 'Name', typ: 'text' },
  { key: 'art', label: 'Art', typ: 'auswahl', optionen: ZONENARTEN },
  {
    key: 'temperatur', label: 'Temperatur', typ: 'bereich', einheit: '°C',
    hinweis: 'Das Maximum geht in die günstige, das Minimum in die ungünstige Rechnung ein.',
  },
  { key: 'notiz', label: 'Notiz', typ: 'notiz' },
];

export const BAUTEIL_FELDER = [
  { key: 'name', label: 'Name', typ: 'text' },
  { key: 'art', label: 'Bauteilart', typ: 'auswahl', optionen: BAUTEILARTEN },
  {
    key: 'u', label: 'U-Wert', typ: 'bereich', einheit: 'W/(m²K)',
    hinweis: 'Bei sicherem Wert Minimum und Maximum gleich eintragen.',
  },
  { key: 'aufbau', label: 'Aufbau (Notiz)', typ: 'notiz' },
  { key: 'quelle', label: 'Quelle des Werts', typ: 'auswahl', optionen: QUELLEN },
];

export const OEFFNUNGS_FELDER = [
  { key: 'name', label: 'Name', typ: 'text' },
  { key: 'art', label: 'Art', typ: 'auswahl', optionen: OEFFNUNGSARTEN },
  { key: 'uw', label: 'Uw-Wert', typ: 'zahl', einheit: 'W/(m²K)' },
  { key: 'quelle', label: 'Quelle des Werts', typ: 'auswahl', optionen: QUELLEN },
];

export function neueZone() {
  return { name: '', art: 'unbeheizt', temperatur: { min: null, max: null }, notiz: '' };
}

export function neuesBauteil() {
  return { name: '', art: 'aussenwand', u: { min: null, max: null }, aufbau: '', quelle: 'schaetzung' };
}

export function neuerOeffnungstyp() {
  return { name: '', art: 'fenster', uw: null, quelle: 'schaetzung' };
}

// Kurzbeschreibung für die Listenkarten.
const bereichText = (b) => (b.min === b.max ? zahlZuText(b.min) : `${zahlZuText(b.min)} – ${zahlZuText(b.max)}`);

export const zoneZeilen = (z) => [`${label(ZONENARTEN, z.art)} · ${bereichText(z.temperatur)} °C`, z.notiz];
export const bauteilZeilen = (b) => [
  `${label(BAUTEILARTEN, b.art)} · U ${bereichText(b.u)} W/(m²K)`,
  `Quelle: ${label(QUELLEN, b.quelle)}`,
  b.aufbau,
];
export const oeffnungsZeilen = (o) => [
  `${label(OEFFNUNGSARTEN, o.art)} · Uw ${zahlZuText(o.uw)} W/(m²K)`,
  `Quelle: ${label(QUELLEN, o.quelle)}`,
];

// --- Räume, Raumflächen, Öffnungen ------------------------------------------------------

export function neuerRaum() {
  return {
    name: '', geschoss: 'EG', status: 'beheizt', theta: 20, flaeche: null, hoehe: null,
    volumenManuell: null, luftwechsel: null, waermeLieferanten: [], notiz: '',
  };
}

// Felder der Raummaske. Für jeden beheizten Raum gibt es ein Prozentfeld, das nur bei
// passivem Status erscheint: so ordnest du zu, welche Räume die Wärme eines passiven Raums liefern.
export function raumFelder(lieferantenKandidaten) {
  const sichtbarBeiPassiv = { feld: 'status', wert: 'passiv' };
  return [
    { key: 'name', label: 'Name', typ: 'text' },
    { key: 'geschoss', label: 'Geschoss', typ: 'auswahl', optionen: GESCHOSSE },
    { key: 'status', label: 'Status', typ: 'auswahl', optionen: STATI },
    {
      key: 'theta', label: 'Soll-Temperatur', typ: 'zahl', einheit: '°C',
      hinweis: 'Bei passiv mitbeheizten Räumen die angenommene Temperatur.',
    },
    { key: 'flaeche', label: 'Fläche', typ: 'zahl', einheit: 'm²' },
    { key: 'hoehe', label: 'Lichte Höhe', typ: 'zahl', einheit: 'm' },
    {
      key: 'volumenManuell', label: 'Volumen (optional)', typ: 'zahl', einheit: 'm³',
      hinweis: 'Leer lassen: Fläche × lichte Höhe.',
    },
    {
      key: 'luftwechsel', label: 'Luftwechsel (optional)', typ: 'bereich', optional: true, einheit: '1/h',
      hinweis: 'Leer lassen: Standard aus den Einstellungen. Ein Raumwert überschreibt den Standard.',
    },
    ...(lieferantenKandidaten.length > 0
      ? [
        {
          key: '_lieferanten', label: 'Wärmelieferanten', typ: 'abschnitt', sichtbarWenn: sichtbarBeiPassiv,
          hinweis: 'Welche beheizten Räume liefern die Wärme für diesen Raum? Anteile in Prozent, die Summe muss 100 ergeben.',
        },
        ...lieferantenKandidaten.map((r) => ({
          key: `lieferant.${r.id}`, label: `Anteil „${r.name}“`, typ: 'zahl', einheit: '%', sichtbarWenn: sichtbarBeiPassiv,
        })),
      ]
      : []),
    { key: 'notiz', label: 'Notiz', typ: 'notiz', hinweis: 'Per Diktat über die iOS-Tastatur möglich.' },
  ];
}

export function neueFlaeche(raumId) {
  return {
    raumId, name: '', bauteilId: '', angrenzend: { art: 'aussen' }, modus: 'laengeHoehe',
    laenge: null, hoehe: null, flaeche: null, oeffnungen: [], notiz: '',
  };
}

const bereichKurz = (b) => (b.min === b.max ? zahlZuText(b.min) : `${zahlZuText(b.min)}–${zahlZuText(b.max)}`);

export function flaechenFelder({ bauteile, zonen, raeume }) {
  const sortiert = (liste) => [...liste].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return [
    { key: 'name', label: 'Bezeichnung (optional)', typ: 'text', hinweis: 'Zum Beispiel „Nordwand“.' },
    {
      key: 'bauteilId', label: 'Bauteil', typ: 'auswahl',
      optionen: [
        { wert: '', label: '– bitte wählen –' },
        ...sortiert(bauteile).map((b) => ({ wert: b.id, label: `${b.name} (U ${bereichKurz(b.u)})` })),
      ],
    },
    {
      key: 'angrenzendWahl', label: 'Grenzt an', typ: 'auswahl',
      optionen: [
        { wert: 'aussen', label: 'Außenluft' },
        ...sortiert(zonen).map((z) => ({ wert: `zone:${z.id}`, label: `Zone: ${z.name}` })),
        ...sortiert(raeume).map((r) => ({ wert: `raum:${r.id}`, label: `Raum: ${r.name}` })),
      ],
    },
    {
      key: 'spiegeln', label: 'Gegenseite im anderen Raum ebenfalls anlegen', typ: 'schalter',
      sichtbarWenn: { feld: 'angrenzendWahl', praefix: 'raum:' },
      hinweis: 'Eine Wand zwischen zwei Räumen zählt im wärmeren Raum. Der Eintrag im anderen Raum ist eine Kopie und ändert sich nicht mit.',
    },
    { key: 'modus', label: 'Maße', typ: 'auswahl', optionen: MASSARTEN_FLAECHE },
    { key: 'laenge', label: 'Länge', typ: 'zahl', einheit: 'm', sichtbarWenn: { feld: 'modus', wert: 'laengeHoehe' } },
    { key: 'hoehe', label: 'Höhe', typ: 'zahl', einheit: 'm', sichtbarWenn: { feld: 'modus', wert: 'laengeHoehe' } },
    { key: 'flaeche', label: 'Fläche', typ: 'zahl', einheit: 'm²', sichtbarWenn: { feld: 'modus', wert: 'flaeche' } },
    { key: 'notiz', label: 'Notiz', typ: 'notiz' },
  ];
}

export function neueOeffnung() {
  return { typId: '', name: '', modus: 'laengeHoehe', laenge: null, hoehe: null, flaeche: null, anzahl: 1 };
}

export function oeffnungsEintragFelder({ oeffnungstypen }) {
  const typen = [...oeffnungstypen].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return [
    {
      key: 'typId', label: 'Öffnungstyp', typ: 'auswahl',
      optionen: [
        { wert: '', label: '– bitte wählen –' },
        ...typen.map((t) => ({ wert: t.id, label: `${t.name} (Uw ${zahlZuText(t.uw)})` })),
      ],
    },
    { key: 'name', label: 'Bezeichnung (optional)', typ: 'text', hinweis: 'Zum Beispiel „Fenster Nord“.' },
    { key: 'modus', label: 'Maße', typ: 'auswahl', optionen: MASSARTEN_OEFFNUNG },
    { key: 'laenge', label: 'Breite', typ: 'zahl', einheit: 'm', sichtbarWenn: { feld: 'modus', wert: 'laengeHoehe' } },
    { key: 'hoehe', label: 'Höhe', typ: 'zahl', einheit: 'm', sichtbarWenn: { feld: 'modus', wert: 'laengeHoehe' } },
    { key: 'flaeche', label: 'Fläche je Stück', typ: 'zahl', einheit: 'm²', sichtbarWenn: { feld: 'modus', wert: 'flaeche' } },
    { key: 'anzahl', label: 'Anzahl', typ: 'zahl' },
  ];
}
