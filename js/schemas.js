// Auswahllisten, Standardwerte und Feldbeschreibungen für die Eingabemasken.
// Die Feldlisten steuern die Formulare, die Validierung steht in validate.js.

import { zahlZuText } from './engine/format.js';
import { HS_HINWEIS, IST_HINWEIS } from './engine/verbrauch.js';

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
    zielVorlauf: 45,
  };
}

export function standardZonen() {
  return [{ id: 'zone-erdreich', name: 'Erdreich', art: 'erdreich', temperatur: { min: 8, max: 12 }, notiz: '' }];
}

export const EINSTELLUNGEN_FELDER = [
  { key: 'projektname', label: 'Projektname', typ: 'text', hinweis: 'Optional, erscheint im Bericht. Beeinflusst keine Rechnung.' },
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
  {
    key: 'zielVorlauf', label: 'Ziel-Vorlauftemperatur', typ: 'zahl', einheit: '°C',
    hinweis: 'Vorlauftemperatur, bei der die Heizkörper bewertet werden. Lässt sich auch im Bereich Heizkörper & Vorlauf einstellen.',
  },
  {
    key: 'waermepumpe.sperrstunden', label: 'Sperrzeit des Netzbetreibers', typ: 'zahl', einheit: 'h pro Tag',
    hinweis: 'Optional, nur für den Zuschlag bei der benötigten Wärmepumpenleistung im Ergebnis. Ohne Eingabe gibt es keinen Zuschlag.',
  },
];

export const ZONEN_FELDER = [
  { key: 'name', label: 'Name', typ: 'text' },
  { key: 'art', label: 'Art', typ: 'auswahl', optionen: ZONENARTEN },
  {
    key: 'temperatur', label: 'Temperatur', typ: 'bereich', einheit: '°C',
    hinweis: 'Das Maximum geht in die günstige, das Minimum in die ungünstige Rechnung ein.',
  },
  {
    key: 'geschoss', label: 'Geschoss im Plan', typ: 'auswahl', sichtbarWenn: { feld: 'art', wert: 'unbeheizt' },
    optionen: [{ wert: '', label: 'Automatisch (Keller, sonst unterstes Geschoss)' }, ...GESCHOSSE],
    hinweis: 'Unbeheizte Zonen stehen im Plan als verschiebbarer Kasten in diesem Geschoss. Wähle das Geschoss, in dem die Zone räumlich liegt.',
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
  return { name: '', art: 'unbeheizt', temperatur: { min: null, max: null }, geschoss: '', notiz: '' };
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
      hinweis: 'Leer lassen: Standard aus den Rechenannahmen. Ein Raumwert überschreibt den Standard.',
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

// --- Heizkörper ------------------------------------------------------------------------

export const BAUARTEN_HK = [
  { wert: 'platten', label: 'Plattenheizkörper' },
  { wert: 'glieder', label: 'Gliederheizkörper' },
  { wert: 'handtuch', label: 'Handtuchheizkörper' },
  { wert: 'wp', label: 'Wärmepumpen-Heizkörper mit Lüfter' },
  { wert: 'sonstige', label: 'Sonstiges' },
];

export const HK_TYPEN = [
  { wert: '', label: '– keine Angabe –' },
  { wert: '11', label: '11' },
  { wert: '21', label: '21' },
  { wert: '22', label: '22' },
  { wert: '33', label: '33' },
  { wert: 'andere', label: 'anderer Typ' },
];

export const MATERIALIEN = [
  { wert: '', label: '– keine Angabe –' },
  { wert: 'stahl', label: 'Stahl' },
  { wert: 'guss', label: 'Guss' },
  { wert: 'aluminium', label: 'Aluminium' },
  { wert: 'sonstiges', label: 'Sonstiges' },
];

export const VENTILE = [
  { wert: 'neu', label: 'Neues Ventil' },
  { wert: 'alt', label: 'Altes Ventil' },
];

export const HK_STATI = [
  { wert: 'bleibt', label: 'Bleibt' },
  { wert: 'entfaellt', label: 'Entfällt' },
  { wert: 'neu', label: 'Neu' },
  { wert: 'geplant', label: 'Geplant' },
];

// Weder Leistung noch Normbedingungen werden vorbelegt. Die Leistung hängt stark von den Bedingungen ab
// (dieselbe Leistung bei 75/65/20 statt 55/45/20 wäre rund doppelt so hoch), also müssen sie bewusst
// gewählt werden. Fehlt die Leistung, gilt der Heizkörper als "Leistung fehlt".
export function neuerHeizkoerper(raumId) {
  return {
    raumId, bauart: 'platten', typ: '', status: 'bleibt', material: '', ventil: 'neu',
    bauhoehe: null, baulaenge: null, bautiefe: null, nabenabstand: null,
    gliederzahl: null, leistungJeGlied: null, normleistung: null,
    normVorlauf: null, normRuecklauf: null, normRaum: null, exponent: null,
    kennlinie: [], kennlinieText: '', kennlinieRaumtemperatur: 20, notiz: '',
  };
}

// Schnellwahlen für die Normbedingungen (Vorlauf/Rücklauf/Raumtemperatur). Die Auswahl hat keine Vorauswahl.
export const NORM_SCHNELLWAHL = [
  { wert: '', label: '– bitte wählen –' },
  { wert: '75/65/20', label: '75/65/20' },
  { wert: '70/55/20', label: '70/55/20' },
  { wert: '55/45/20', label: '55/45/20' },
  { wert: '90/70/20', label: '90/70/20' },
  { wert: 'eigen', label: 'eigene Werte' },
];

// Auswahlwert zu gespeicherten Normbedingungen: passende Schnellwahl, "eigen" oder nichts.
export function normWahlVon(h) {
  const zahlen = [h.normVorlauf, h.normRuecklauf, h.normRaum];
  if (zahlen.every((z) => typeof z === 'number')) {
    const text = zahlen.join('/');
    return NORM_SCHNELLWAHL.some((o) => o.wert === text) ? text : 'eigen';
  }
  return zahlen.some((z) => typeof z === 'number') ? 'eigen' : '';
}

const keinWp = { feld: 'bauart', in: ['platten', 'glieder', 'handtuch', 'sonstige'] };

export function heizkoerperFelder() {
  return [
    { key: 'bauart', label: 'Bauart', typ: 'auswahl', optionen: BAUARTEN_HK },
    {
      key: 'status', label: 'Status', typ: 'auswahl', optionen: HK_STATI,
      hinweis: 'Heizkörper mit Status „Entfällt“ zählen bei der Deckung nicht mit.',
    },
    { key: 'typ', label: 'Typ', typ: 'auswahl', optionen: HK_TYPEN, sichtbarWenn: { feld: 'bauart', in: ['platten'] } },
    { key: 'material', label: 'Material', typ: 'auswahl', optionen: MATERIALIEN },
    { key: 'bauhoehe', label: 'Bauhöhe', typ: 'zahl', einheit: 'mm' },
    { key: 'baulaenge', label: 'Baulänge', typ: 'zahl', einheit: 'mm' },
    { key: 'bautiefe', label: 'Bautiefe', typ: 'zahl', einheit: 'mm' },
    { key: 'nabenabstand', label: 'Nabenabstand', typ: 'zahl', einheit: 'mm', sichtbarWenn: { feld: 'bauart', in: ['glieder', 'handtuch', 'sonstige'] } },
    { key: 'gliederzahl', label: 'Gliederzahl', typ: 'zahl', sichtbarWenn: { feld: 'bauart', in: ['glieder'] } },
    {
      key: 'leistungJeGlied', label: 'Leistung je Glied', typ: 'zahl', einheit: 'W', sichtbarWenn: { feld: 'bauart', in: ['glieder'] },
      hinweis: 'Bezogen auf die Normbedingungen unten (Pflichtangabe). Gilt nur, wenn keine Normleistung eingetragen ist.',
    },
    {
      key: 'normleistung', label: 'Normleistung', typ: 'zahl', einheit: 'W', sichtbarWenn: keinWp,
      hinweis: 'Laut Typenschild oder Datenblatt bei den Normbedingungen. Leer lassen, wenn sie unbekannt ist: '
        + 'der Heizkörper gilt dann als „Leistung fehlt“.',
    },
    {
      key: 'normWahl', label: 'Normbedingungen (Vorlauf/Rücklauf/Raumtemperatur)', typ: 'auswahl', optionen: NORM_SCHNELLWAHL,
      fuellt: ['normVorlauf', 'normRuecklauf', 'normRaum'], sichtbarWenn: keinWp,
      hinweis: 'Pflichtangabe ohne Vorauswahl. Es sind die Bedingungen, auf die sich die Normleistung und bei Gliederheizkörpern '
        + 'die Leistung je Glied beziehen (Datenblatt, Typenschild, Tabelle). Ältere Tabellen nennen oft 90/70/20. '
        + 'Eine falsche Wahl verfälscht die Leistung stark.',
    },
    { key: 'normVorlauf', label: 'Normbedingung: Vorlauf', typ: 'zahl', einheit: '°C', sichtbarWenn: keinWp },
    { key: 'normRuecklauf', label: 'Normbedingung: Rücklauf', typ: 'zahl', einheit: '°C', sichtbarWenn: keinWp },
    { key: 'normRaum', label: 'Normbedingung: Raumtemperatur', typ: 'zahl', einheit: '°C', sichtbarWenn: keinWp },
    {
      key: 'exponent', label: 'Heizkörperexponent n (optional)', typ: 'zahl', sichtbarWenn: keinWp,
      hinweis: 'Leer lassen: Standard aus den Rechenannahmen.',
    },
    {
      key: 'kennlinieText', label: 'Kennlinie aus dem Datenblatt', typ: 'notiz', sichtbarWenn: { feld: 'bauart', in: ['wp'] },
      hinweis: 'Pro Zeile ein Wertepaar aus Vorlauftemperatur in °C und Leistung in W, zum Beispiel „35 600“. '
        + 'Mindestens zwei Paare. Zwischen den Paaren wird linear interpoliert, außerhalb gibt es keine Werte.',
    },
    {
      key: 'kennlinieRaumtemperatur', label: 'Raumtemperatur laut Datenblatt', typ: 'zahl', einheit: '°C',
      sichtbarWenn: { feld: 'bauart', in: ['wp'] },
      hinweis: 'Für diese Raumtemperatur gelten die Leistungswerte. Die App rechnet sie nicht um.',
    },
    {
      key: 'ventil', label: 'Ventil', typ: 'auswahl', optionen: VENTILE,
      hinweis: 'Alte Ventile erscheinen nur als Hinweis (kein hydraulischer Abgleich möglich). Die Leistung ändert sich dadurch nicht.',
    },
    { key: 'notiz', label: 'Notiz', typ: 'notiz' },
  ];
}

// --- Verbrauchsabgleich ----------------------------------------------------------------

// Monate der Heizperiode in der Reihenfolge Oktober bis September, zum Anlegen einer leeren Tabelle.
export const HEIZPERIODE_MONATE = [
  'Oktober', 'November', 'Dezember', 'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September',
];

// Nutzungsgrade, Heizwerte, Gradtage und die tatsächliche Innentemperatur werden nie vorbelegt. Nur der
// Nicht-Heizungs-Anteil startet mit 0 und die Soll-Innentemperatur mit dem Vorschlag aus den Räumen
// (beides sichtbar und änderbar).
export function neuerVerbrauch(innentemperaturSoll) {
  return {
    name: '', gasKwh: null, nichtFuerHeizungKwh: 0, kesselNutzungsgrad: { min: null, max: null },
    holzRm: null, heizwertRm: null, ofenWirkungsgrad: null,
    innentemperaturIst: { min: null, max: null }, innentemperaturSoll: innentemperaturSoll ?? null,
    monate: [], notiz: '',
  };
}

export function verbrauchFelder({ vorschlag }) {
  return [
    { key: 'name', label: 'Bezeichnung', typ: 'text', hinweis: 'Zum Beispiel „Heizperiode 2023/24“.' },
    { key: 'gasKwh', label: 'Gasverbrauch im Zeitraum', typ: 'zahl', einheit: 'kWh', hinweis: 'Laut Gasrechnung in kWh.' },
    {
      key: 'nichtFuerHeizungKwh', label: 'Davon nicht für Heizung (Warmwasser, Gasherd, Sonstiges)', typ: 'zahl', einheit: 'kWh',
      hinweis: 'Gas, das nicht zum Heizen diente, wird vom Gasverbrauch abgezogen. Startwert 0: dann zählt der ganze Gasverbrauch '
        + 'als Heizung, und die Heizlast fällt zu hoch aus.',
    },
    {
      key: 'kesselNutzungsgrad', label: 'Kesselnutzungsgrad', typ: 'bereich', einheit: '%',
      hinweis: `Hinweis: ${HS_HINWEIS}. Minimum und Maximum geben die Unsicherheit an.`,
    },
    { key: 'holzRm', label: 'Holzmenge (optional)', typ: 'zahl', einheit: 'Rm', hinweis: 'Raummeter im Zeitraum. Leer oder 0: kein Holz.' },
    {
      key: 'heizwertRm', label: 'Heizwert je Raummeter (nur mit Holz)', typ: 'bereich', optional: true, einheit: 'kWh/Rm',
      hinweis: 'Hängt von Holzart und Feuchte ab. Es gibt keinen Vorgabewert.',
    },
    { key: 'ofenWirkungsgrad', label: 'Wirkungsgrad Kaminofen (nur mit Holz)', typ: 'bereich', optional: true, einheit: '%' },
    {
      key: 'innentemperaturIst', label: 'Tatsächliche mittlere Innentemperatur im Verbrauchszeitraum', typ: 'bereich', einheit: '°C',
      hinweis: `${IST_HINWEIS} Minimum und Maximum, weil du die Temperatur nur schätzen kannst. Sie geht in die Gradtag-Umrechnung und damit `
        + 'in den Wärmeverlust H ein. Pflichtangabe, es gibt keinen Vorgabewert.',
    },
    {
      key: 'innentemperaturSoll', label: 'Mittlere Soll-Innentemperatur für die Auslegung', typ: 'zahl', einheit: '°C',
      hinweis: 'Nur für die Hochrechnung Φ_N = H · (θ_soll − θ_N). '
        + (vorschlag === null
          ? 'Ohne beheizte oder passive Räume gibt es keinen Vorschlag.'
          : `Vorschlag: ${zahlZuText(vorschlag)} °C, der flächengewichtete Mittelwert der Soll-Temperaturen aller beheizten und passiven Räume.`),
    },
    { key: 'notiz', label: 'Notiz', typ: 'notiz' },
  ];
}

// --- Wärmepumpen-Katalog -----------------------------------------------------------------------

export const BAFA_STATI = [
  { wert: 'unbekannt', label: 'unbekannt' },
  { wert: 'ja', label: 'ja' },
  { wert: 'nein', label: 'nein' },
];

export const WP_PUNKT_SPALTEN = [
  { key: 'aussen', label: 'Außentemperatur', einheit: '°C' },
  { key: 'vorlauf', label: 'Vorlauftemperatur', einheit: '°C' },
  { key: 'max', label: 'Max. Heizleistung', einheit: 'kW' },
  { key: 'min', label: 'Min. Heizleistung (optional)', einheit: 'kW' },
  { key: 'cop', label: 'COP (optional)', einheit: '' },
];

export const WAERMEPUMPEN_FELDER = [
  { key: 'hersteller', label: 'Hersteller', typ: 'text' },
  { key: 'modell', label: 'Modell', typ: 'text' },
  { key: 'typ', label: 'Genaue Typbezeichnung', typ: 'text', hinweis: 'Zum Beispiel mit Leistungsstufe und Variante, so wie im Angebot oder Datenblatt.' },
  { key: 'anbieter', label: 'Anbieter / Angebot', typ: 'text' },
  { key: 'preis', label: 'Preis', typ: 'bereich', einheit: '€', optional: true, hinweis: 'Optional, als Minimum und Maximum.' },
  { key: 'datenblatt', label: 'Link zum Datenblatt', typ: 'text', hinweis: 'Nur als Text oder Link gespeichert, die App ruft nichts ab.' },
  { key: 'notiz', label: 'Notiz', typ: 'notiz' },
  { key: 'bafa', label: 'BAFA', typ: 'abschnitt', hinweis: 'Die BAFA-Nennleistung ist kein Auslegungswert. Für die Prüfung die Heizleistung aus dem Datenblatt verwenden.' },
  { key: 'bafa.foerderfaehig', label: 'Förderfähig', typ: 'auswahl', optionen: BAFA_STATI },
  { key: 'bafa.nennleistung55', label: 'BAFA-Nennleistung bei 55 °C', typ: 'zahl', einheit: 'kW', hinweis: 'Nur für die grobe Vorauswahl.' },
  { key: 'bafa.eta35', label: 'ETAs bei 35 °C', typ: 'zahl', einheit: '%' },
  { key: 'bafa.eta55', label: 'ETAs bei 55 °C', typ: 'zahl', einheit: '%' },
  { key: 'bafa.kaeltemittel', label: 'Kältemittel', typ: 'text' },
  { key: 'bafa.stand', label: 'Stand der Angaben', typ: 'datum' },
  { key: 'leistung', label: 'Leistungspunkte aus dem Datenblatt', typ: 'abschnitt', hinweis: 'Pflicht für die Prüfung: mindestens A−7 mit W35 und W55 (maximale Heizleistung) sowie ein Punkt mit minimaler Leistung bei A7 oder höher. Beliebig viele Zeilen.' },
  { key: 'punkte', label: 'Punkte', typ: 'punkte', spalten: WP_PUNKT_SPALTEN },
  { key: 'schall', label: 'Schallleistungspegel Außengerät', typ: 'zahl', einheit: 'dB(A)', hinweis: 'Optional. Die App vergleicht Geräte nur untereinander.' },
];

export function neueWaermepumpe() {
  return {
    hersteller: '', modell: '', typ: '', anbieter: '', preis: null, datenblatt: '', notiz: '',
    bafa: { foerderfaehig: 'unbekannt', nennleistung55: null, eta35: null, eta55: null, kaeltemittel: '', stand: '' },
    punkte: [], schall: null,
  };
}

// Fehlende Felder ergänzen (Import, Bearbeiten): Listen, BAFA-Block, Standardwerte.
export function normalisiereWaermepumpe(roh) {
  const g = roh && typeof roh === 'object' ? roh : {};
  const n = neueWaermepumpe();
  return {
    ...n, ...g,
    bafa: { ...n.bafa, ...(g.bafa && typeof g.bafa === 'object' ? g.bafa : {}) },
    punkte: Array.isArray(g.punkte) ? g.punkte : [],
    preis: g.preis && typeof g.preis === 'object' ? g.preis : null,
  };
}
