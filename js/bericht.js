// Ergebnisbericht: baut aus dem Projektstand die Abschnitte, Tabellen und Listen für Bildschirm und Druck.
// Reine Funktion ohne Oberflächenbezug, damit die Zahlen testbar sind. Die Darstellung steht in views/bericht.js.
//
// Ein Bericht ist { titel, projektname, erstelltAm, seitentitel, abschnitte: [{ titel, neueSeite, bloecke }] }.
// Blöcke: { art: 'text' | 'box' | 'zwischentitel' | 'liste' | 'paare' | 'tabelle', ... }, siehe unten.

import { formatZahl, zahlZuText } from './engine/format.js';
import { GEGENPROBE_TOLERANZ_W } from './engine/heatload.js';
import { VORLAUF_MIN, VORLAUF_MAX } from './engine/vorlauf.js';
import { annahmen as verbrauchAnnahmen, FREMDWAERME_HINWEIS, HS_HINWEIS } from './engine/verbrauch.js';
import { rechne, bewerteVorlauf } from './daten.js';
import { raumVolumen, nettoFlaeche, flaecheAusMassen, oeffnungsGesamtflaeche } from './modell.js';
import { datumText, inhaltsHinweise } from './io.js';
import { baueplan, pruefZeilen } from './plan.js';
import { baueVergleich, vergleichTabellen, bandText } from './vergleich.js';
import { szenarioInfo, kostenNachFoerderung, kostenEingetragen } from './szenario.js';
import {
  watt, wattBereich, wattBereichVon, mitVorzeichen, raumName, flaechenBezeichnung, angrenzendText, massText,
  meldungsTexte, berechneteBandbreite, auswerten, abweichungsText, FEHLER_TEXT, vorlaufText, hinweisText,
  leistungFehlt, heizkoerperLeistungsText, heizkoerperMasseText,
} from './anzeige.js';
import {
  label, ZONENARTEN, BAUTEILARTEN, QUELLEN, OEFFNUNGSARTEN, STATI, BAUARTEN_HK, HK_STATI, HK_TYPEN, VENTILE,
} from './schemas.js';

const z = zahlZuText;
const bereichText = (b) => (b.min === b.max ? z(b.min) : `${z(b.min)} – ${z(b.max)}`);

const text = (t) => ({ art: 'text', text: t });
const box = (t, stufe = 'hinweis') => ({ art: 'box', text: t, stufe });
const zwischentitel = (t) => ({ art: 'zwischentitel', text: t });
const liste = (eintraege) => ({ art: 'liste', eintraege });
const paare = (zeilen) => ({ art: 'paare', zeilen });
// ausrichtung: ein Buchstabe je Spalte, l = links, r = rechts
const tabelle = (kopf, zeilen, ausrichtung, summenzeile = false, hervor = []) => ({ art: 'tabelle', kopf, zeilen, ausrichtung, summenzeile, hervor });

const nachName = (a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'de');

export const HAFTUNGSHINWEIS =
  'Eigene Prüfung und Auslegungshilfe nach einem vereinfachten Verfahren in der Struktur der DIN EN 12831-1. '
  + 'Dieser Bericht ersetzt keine offizielle Heizlastberechnung, zum Beispiel für Förderanträge.';

// --- Abschnitte ------------------------------------------------------------------------------

function vorlaufDesHauses(bewertung) {
  if (!bewertung || bewertung.zeilen.length === 0) return 'keine beheizten Räume';
  const best = bewertung.zeilen.find((r) => r.bestimmend);
  const unsicher = bewertung.unsicher.length > 0
    ? ` Achtung: Für ${bewertung.unsicher.length} ${bewertung.unsicher.length === 1 ? 'Raum' : 'Räume'} ohne Ergebnis ist die Rangfolge unsicher.`
    : '';
  if (!best) return `nicht bestimmbar.${unsicher}`;
  if (best.vorlauf.status === 'ok') return `${formatZahl(best.vorlauf.vorlauf, 1)} °C (ungünstig), bestimmender Raum: „${best.name}“.${unsicher}`;
  return `über ${VORLAUF_MAX} °C: „${best.name}“ ist auch bei ${VORLAUF_MAX} °C nicht gedeckt.${unsicher}`;
}

function uebersicht(ctx) {
  const { projekt, ergebnis, fehler, bewertung, berechnet, ziel } = ctx;
  const e = projekt.einstellungen;
  const bloecke = [];
  if (fehler) bloecke.push(box(`Rechenfehler: ${fehler}`, 'fehler'));
  if (!ergebnis || ergebnis.raeume.length === 0) {
    bloecke.push(text('Es gibt noch keine berechenbaren Räume. Der Bericht enthält deshalb nur die Eingabedaten.'));
    return bloecke;
  }
  const g = ergebnis.gebaeude;
  const differenz = Math.max(Math.abs(g.guenstig.differenz), Math.abs(g.ungunstig.differenz));
  const zeilen = [
    [`Gebäudeheizlast bei θ_e = ${z(e.thetaAussen)} °C`, `${wattBereich(g.guenstig.summe, g.ungunstig.summe)} (günstig bis ungünstig), Mittel ${watt(g.mittel.summe)}`],
    ['Gegenprobe der Gebäudesumme', differenz <= GEGENPROBE_TOLERANZ_W
      ? `bestanden, Differenz ${formatZahl(differenz, 1)} W`
      : `Abweichung von ${formatZahl(differenz, 1)} W, siehe Hinweise`],
    ['Nötige Vorlauftemperatur des Hauses', vorlaufDesHauses(bewertung)],
    ['Gewählte Ziel-Vorlauftemperatur', `${ziel} °C (Rücklauf ${ziel - e.spreizung} °C bei ${z(e.spreizung)} K Spreizung)`],
  ];
  for (const doc of projekt.verbrauch) {
    const aus = auswerten(doc, projekt, berechnet);
    zeilen.push([
      `Verbrauchsabgleich „${doc.name}“`,
      aus.ergebnis?.status === 'ok'
        ? `${wattBereichVon(aus.ergebnis.heizlast)} aus dem Verbrauch${aus.vergleich ? `, ${abweichungsText(aus.vergleich).replace(' (Mittelwert Verbrauch gegenüber Berechnung)', '')}` : ''}`
        : 'unvollständig, nicht ausgewertet',
    ]);
  }
  bloecke.push(paare(zeilen));
  return bloecke;
}

function projektdaten(projekt) {
  const e = projekt.einstellungen;
  const anzahl = (status) => projekt.raeume.filter((r) => r.status === status).length;
  return [paare([
    ['Projekt', e.projektname || 'ohne Namen'],
    ['Normaußentemperatur θ_e', `${z(e.thetaAussen)} °C`],
    ['Wärmebrückenzuschlag ΔU_WB', `${bereichText(e.dUWB)} W/(m²K), nur auf die Gebäudehülle`],
    ['Standard-Luftwechsel', `${bereichText(e.luftwechselStandard)} 1/h`],
    ['Erdreich-Korrekturfaktor f_g', z(e.fg)],
    ['Aufheizzuschlag', e.aufheizzuschlag.aktiv ? `${z(e.aufheizzuschlag.wProM2)} W/m² Raumfläche` : 'nicht verwendet'],
    ['Spreizung Vor-/Rücklauf', `${z(e.spreizung)} K`],
    ['Standard-Heizkörperexponent n', z(e.heizkoerperExponent)],
    ['Erfasst', `${projekt.raeume.length} Räume (${anzahl('beheizt')} beheizt, ${anzahl('passiv')} passiv, ${anzahl('unbeheizt')} unbeheizt), `
      + `${projekt.flaechen.length} Raumflächen, ${projekt.heizkoerper.length} Heizkörper, ${projekt.verbrauch.length} Verbrauchsabgleiche`],
  ])];
}

function verfahren(projekt) {
  const e = projekt.einstellungen;
  const erdreich = projekt.zonen.filter((zn) => zn.art === 'erdreich');
  return [liste([
    'Verfahren: vereinfacht, in der Struktur der DIN EN 12831-1. Transmission Φ_T = A · (U + ΔU_WB) · (θ_int − θ_angrenzend), Lüftung Φ_V = 0,34 · n · V · (θ_int − θ_e).',
    `Normaußentemperatur θ_e = ${z(e.thetaAussen)} °C, in beiden Rechnungen fest.`,
    'Bandbreite: Jede Berechnung läuft zweimal. Günstig: U-Wert-, ΔU_WB- und Luftwechsel-Minimum und höchste Zonentemperatur. '
      + 'Ungünstig: jeweils die Maxima und die niedrigste Zonentemperatur. Der Mittelwert ist der Durchschnitt beider Ergebnisse.',
    `Wärmebrückenzuschlag ΔU_WB = ${bereichText(e.dUWB)} W/(m²K), nur auf Bauteile der Gebäudehülle (Außenluft, Erdreich, unbeheizte Zonen, Nachbar), nicht auf Innenbauteile.`,
    `Erdreich: Korrekturfaktor f_g = ${z(e.fg)}${erdreich.length > 0 ? `, Erdreichtemperatur ${erdreich.map((zn) => `„${zn.name}“ ${bereichText(zn.temperatur)} °C`).join(', ')}` : ''}.`,
    `Luftwechsel: Standard ${bereichText(e.luftwechselStandard)} 1/h. Ein Raumwert überschreibt den Standard.`,
    `Aufheizzuschlag: ${e.aufheizzuschlag.aktiv ? `${z(e.aufheizzuschlag.wProM2)} W/m² Raumfläche` : 'nicht verwendet'}.`,
    'Unbeheizte Räume werden nicht gerechnet, ihre Wirkung läuft über eine Zone mit Temperatur.',
    'Raum-zu-Raum: Ein Raum verliert Wärme an einen kälteren beheizten Nachbarraum, A · U · ΔT ohne ΔU_WB. Das zählt in seiner Raumheizlast. '
      + 'Gewinne aus wärmeren Nachbarräumen werden nicht gutgeschrieben (sichere Seite). Diese Ströme stehen nicht in der Gebäudesumme.',
    'Passive Räume: Ihre Verluste nach außen, ins Erdreich, zu Nachbarn und zu unbeheizten Zonen zählen voll in der Gebäudeheizlast. '
      + 'Der Netto-Verlust wird prozentual auf die liefernden beheizten Räume verteilt und erhöht deren Raumheizlast. Verluste an passive Räume werden nicht zusätzlich angerechnet.',
    'Gebäudeheizlast: direkt aus allen Flächen an Außenluft, Erdreich, Nachbar und unbeheizten Zonen plus Lüftung. '
      + 'Die Gegenprobe vergleicht sie mit der Summe der Raumheizlasten plus angerechneter Raum-zu-Raum-Verluste und muss null ergeben.',
    `Heizkörper: Φ = Φ_n · (ΔT_log / ΔT_log,n)^n mit ΔT_log = (t_V − t_R) / ln((t_V − t_i) / (t_R − t_i)), Standardexponent n = ${z(e.heizkoerperExponent)}. `
      + 'Wärmepumpen-Heizkörper: lineare Interpolation der Datenblattwerte, keine Extrapolation. Fehlende Leistungen werden nicht ergänzt: '
      + 'Ohne Leistung gibt es für den Raum keine Vorlauftemperatur. Alte Ventile sind nur ein Hinweis (kein hydraulischer Abgleich möglich), die Leistung ändert sich nicht.',
    `Nötige Vorlauftemperatur: die kleinste Temperatur zwischen ${VORLAUF_MIN} und ${VORLAUF_MAX} °C, bei der die Heizkörper mit Status „Bleibt“, „Neu“ oder „Geplant“ die ungünstige Raumheizlast decken. `
      + `Rücklauf = Vorlauf − ${z(e.spreizung)} K, Raumtemperatur = Soll-Temperatur des Raums. Die Raumheizlast enthält zugerechnete Anteile passiver Räume und Raum-zu-Raum-Verluste.`,
  ])];
}

function zonenAbschnitt(projekt) {
  if (projekt.zonen.length === 0) return [text('Keine Zonen erfasst.')];
  return [tabelle(
    ['Name', 'Art', 'Temperatur (°C)', 'Notiz'],
    projekt.zonen.map((zn) => [zn.name, label(ZONENARTEN, zn.art), bereichText(zn.temperatur), zn.notiz || '']),
    'llrl',
  ), text('Außenluft ist keine Zone, sie folgt der Normaußentemperatur.')];
}

function bauteileAbschnitt(projekt) {
  if (projekt.bauteile.length === 0) return [text('Keine Bauteile erfasst.')];
  return [tabelle(
    ['Name', 'Art', 'U-Wert (W/(m²K))', 'Quelle', 'Aufbau'],
    projekt.bauteile.map((b) => [b.name, label(BAUTEILARTEN, b.art), bereichText(b.u), label(QUELLEN, b.quelle), b.aufbau || '']),
    'llrll',
  )];
}

function oeffnungenAbschnitt(projekt) {
  if (projekt.oeffnungstypen.length === 0) return [text('Keine Öffnungstypen erfasst.')];
  return [tabelle(
    ['Name', 'Art', 'Uw (W/(m²K))', 'Quelle'],
    projekt.oeffnungstypen.map((o) => [o.name, label(OEFFNUNGSARTEN, o.art), z(o.uw), label(QUELLEN, o.quelle)]),
    'llrl',
  )];
}

function raeumeAbschnitt(ctx) {
  const { projekt, ergebnis } = ctx;
  const e = projekt.einstellungen;
  const bloecke = [];
  const zeilen = projekt.raeume.map((r) => {
    const erg = ergebnis.raeume.find((x) => x.id === r.id);
    const volumen = raumVolumen(r);
    const basis = [
      r.name, r.geschoss, label(STATI, r.status), typeof r.theta === 'number' ? z(r.theta) : '–',
      Number.isFinite(r.flaeche) ? formatZahl(r.flaeche, 2) : '–', Number.isFinite(volumen) ? formatZahl(volumen, 1) : '–',
      r.luftwechsel ? bereichText(r.luftwechsel) : `Standard (${bereichText(e.luftwechselStandard)})`,
    ];
    if (!erg) return [...basis, 'nicht gerechnet', '', '', ''];
    const passiv = r.status === 'passiv';
    return [
      ...basis,
      passiv ? `${wattBereich(erg.guenstig.netto, erg.ungunstig.netto)} (netto)` : wattBereich(erg.guenstig.heizlast, erg.ungunstig.heizlast),
      watt(passiv ? erg.mittel.netto : erg.mittel.heizlast),
      wattBereich(erg.guenstig.raumZuRaumSumme, erg.ungunstig.raumZuRaumSumme),
      passiv ? '' : wattBereich(erg.guenstig.zugeteilt, erg.ungunstig.zugeteilt),
    ];
  });
  const g = ergebnis.gebaeude;
  zeilen.push(['Gebäude gesamt', '', '', '', '', '', '', wattBereich(g.guenstig.summe, g.ungunstig.summe), watt(g.mittel.summe), '', '']);
  bloecke.push(tabelle(
    ['Raum', 'Geschoss', 'Status', 'Soll (°C)', 'Fläche (m²)', 'Volumen (m³)', 'Luftwechsel (1/h)', 'Heizlast (W)', 'Mittel (W)', 'davon Raum-zu-Raum (W)', 'davon passiv (W)'],
    zeilen, 'lllrrrrrrrr', true,
  ));
  bloecke.push(text('Bei passiven Räumen steht der Netto-Verlust, der auf die liefernden Räume verteilt wird und in der Gebäudeheizlast enthalten ist. '
    + 'Die Gebäudeheizlast ist die direkte Summe aller Verluste an Außenluft, Erdreich, Nachbar und unbeheizte Zonen plus Lüftung.'));

  const lieferungen = projekt.raeume.filter((r) => r.status === 'passiv').map((r) => `${r.name}: ${
    (r.waermeLieferanten ?? []).length > 0
      ? r.waermeLieferanten.map((l) => `${raumName(projekt, l.raumId)} ${z(l.prozent)} %`).join(', ')
      : 'keine Zuordnung'}`);
  if (lieferungen.length > 0) bloecke.push(zwischentitel('Wärmelieferanten passiver Räume'), liste(lieferungen));

  const rzr = [];
  for (const erg of ergebnis.raeume) {
    for (const gl of erg.guenstig.raumZuRaum) {
      const un = erg.ungunstig.raumZuRaum.find((x) => x.flaecheId === gl.flaecheId) ?? gl;
      const f = projekt.flaechen.find((x) => x.id === gl.flaecheId);
      rzr.push([erg.name, f ? flaechenBezeichnung(projekt, f) : '–', raumName(projekt, gl.nachbarId), wattBereich(gl.leistung, un.leistung)]);
    }
  }
  bloecke.push(zwischentitel('Angerechnete Raum-zu-Raum-Verluste'));
  bloecke.push(rzr.length > 0 ? tabelle(['Raum', 'Fläche', 'an Raum', 'Verlust (W)'], rzr, 'lllr') : text('Keine.'));

  const zeile = (name, f) => [name, ...['guenstig', 'ungunstig'].map((fall) => f(g[fall]))];
  bloecke.push(zwischentitel('Gegenprobe der Gebäudesumme'));
  bloecke.push(tabelle(['', 'günstig (W)', 'ungünstig (W)'], [
    zeile('Gebäudesumme direkt (Hüllflächen und Lüftung)', (x) => formatZahl(x.summe, 1)),
    zeile('+ angerechnete Raum-zu-Raum-Verluste', (x) => formatZahl(x.raumZuRaum, 1)),
    zeile('= erwartete Summe der Raumheizlasten', (x) => formatZahl(x.summe + x.raumZuRaum, 1)),
    zeile('Summe der Raumheizlasten (beheizte Räume)', (x) => formatZahl(x.heizlast, 1)),
    zeile('Differenz', (x) => formatZahl(x.differenz, 1)),
  ], 'lrr'));
  return bloecke;
}

function flaechenAnlage(ctx) {
  const { projekt, ergebnis } = ctx;
  const bloecke = [];
  for (const erg of ergebnis.raeume) {
    const raum = projekt.raeume.find((r) => r.id === erg.id);
    bloecke.push(zwischentitel(`${erg.name} (${label(STATI, erg.status)}, ${z(raum.theta)} °C)`));
    const flaechen = projekt.flaechen.filter((f) => f.raumId === erg.id);
    if (flaechen.length === 0) {
      bloecke.push(text('Keine Raumflächen erfasst.'));
      continue;
    }
    bloecke.push(tabelle(
      ['Fläche', 'Bauteil', 'Grenzt an', 'Maße', 'Öffnungen', 'Netto (m²)', 'U (W/(m²K))', 'Verlust (W)'],
      flaechen.map((f) => {
        const bauteil = projekt.bauteile.find((b) => b.id === f.bauteilId);
        const g = erg.guenstig.flaechen.find((x) => x.id === f.id);
        const u = erg.ungunstig.flaechen.find((x) => x.id === f.id);
        const verlust = (x) => (x ? x.wand + x.oeffnungen + x.raumZuRaum : null);
        const oeffnungen = (f.oeffnungen ?? []).map((o) => {
          const typ = projekt.oeffnungstypen.find((t) => t.id === o.typId);
          return `${o.anzahl} × ${typ?.name ?? 'Typ fehlt'}${o.name ? ` „${o.name}“` : ''} (${formatZahl(oeffnungsGesamtflaeche(o), 2)} m²)`;
        });
        return [
          flaechenBezeichnung(projekt, f),
          bauteil?.name ?? 'fehlt im Katalog',
          angrenzendText(projekt, f.angrenzend),
          Number.isFinite(flaecheAusMassen(f)) ? massText(f) : 'unvollständig',
          oeffnungen.join('; ') || '–',
          Number.isFinite(flaecheAusMassen(f)) ? formatZahl(nettoFlaeche(f), 2) : '–',
          bauteil ? bereichText(bauteil.u) : '–',
          g ? wattBereich(verlust(g), verlust(u)) : 'nicht gerechnet',
        ];
      }),
      'lllllrrr',
    ));
  }
  return bloecke;
}

// Plan der Raumbeziehungen, Auffälligkeiten und Vollständigkeitsprüfung auf einer eigenen Seite.
function planAbschnitt(ctx) {
  const { projekt, ergebnis } = ctx;
  const plan = baueplan(projekt, ergebnis);
  const bloecke = [
    text('Schema der Räume (Kästen nach Geschoss). Zwischen den Räumen laufen die Wände, die Stärke folgt der Fläche. '
      + 'Ein Pfeil zeigt, in welche Richtung der Wärmeverlust zwischen zwei beheizten Räumen angerechnet wird. '
      + 'Gestrichelte Linien zeigen die Wärmelieferanten passiver Räume mit ihrem Anteil. '
      + 'Die farbigen Marken im Kasten nennen die Fläche in m² an Außenluft, Nachbar, unbeheizter Zone und Erdreich.'),
    { art: 'plan', plan },
    zwischentitel('Auffälligkeiten'),
  ];
  const raumNameVon = (id) => raumName(projekt, id);
  bloecke.push(plan.auffaelligkeiten.length === 0
    ? text('Keine Auffälligkeiten.')
    : liste(plan.auffaelligkeiten.map((a) => `„${raumNameVon(a.raumId)}“: ${a.text}`)));
  bloecke.push(
    zwischentitel('Vollständigkeit je Raum (✓ in Ordnung, ⚠ prüfen, ✗ fehlt)'),
    tabelle(['Raum', 'Prüfung', 'Ergebnis', 'Begründung'], pruefZeilen(plan.pruefung), 'llll'),
  );
  return bloecke;
}

function heizkoerperAbschnitt(projekt) {
  if (projekt.heizkoerper.length === 0) return [text('Keine Heizkörper erfasst.')];
  const sortiert = [...projekt.heizkoerper].sort((a, b) => raumName(projekt, a.raumId).localeCompare(raumName(projekt, b.raumId), 'de'));
  return [tabelle(
    ['Raum', 'Heizkörper', 'Status', 'Leistung', 'Ventil', 'Notiz'],
    sortiert.map((h) => {
      const art = `${label(BAUARTEN_HK, h.bauart)}${h.bauart === 'platten' && h.typ ? ` Typ ${label(HK_TYPEN, h.typ)}` : ''}`;
      const masse = heizkoerperMasseText(h);
      return [
        raumName(projekt, h.raumId), masse ? `${art}, ${masse}` : art, label(HK_STATI, h.status),
        leistungFehlt(h) ? 'Leistung fehlt' : heizkoerperLeistungsText(h), label(VENTILE, h.ventil), h.notiz || '',
      ];
    }),
    'llllll',
  )];
}

function vorlaufAbschnitt(ctx) {
  const { bewertung, ziel } = ctx;
  if (!bewertung || bewertung.zeilen.length === 0) return [text('Keine beheizten Räume.')];
  const bloecke = [tabelle(
    ['Raum', 'Heizlast (W)', 'davon Raum-zu-Raum (W)', 'davon passiv (W)', `Installiert bei ${ziel} °C (W)`, 'Deckung', 'Über-/Unterdeckung (W)', 'Nötiger Vorlauf ungünstig', 'Nötiger Vorlauf günstig'],
    bewertung.zeilen.map((r) => [
      r.bestimmend ? `${r.name} (bestimmender Raum)` : r.name,
      formatZahl(r.heizlast, 0), formatZahl(r.davonRaumZuRaum, 0), formatZahl(r.davonPassiv, 0),
      r.installiert === null ? '–' : formatZahl(r.installiert, 0),
      r.deckung === null ? '–' : `${formatZahl(r.deckung, 0)} %`,
      r.differenz === null ? '–' : mitVorzeichen(r.differenz, 0).replace(' %', ''),
      vorlaufText(r.vorlauf), vorlaufText(r.vorlaufGuenstig),
    ]),
    'lrrrrrrrr',
  )];
  const hinweise = bewertung.zeilen.flatMap((r) => r.hinweise.map((h) => `${r.name}: ${hinweisText(h, ziel)}`));
  if (hinweise.length > 0) bloecke.push(zwischentitel('Hinweise zu den Räumen'), liste(hinweise));
  return bloecke;
}

function verbrauchAbschnitt(ctx) {
  const { projekt, berechnet } = ctx;
  if (projekt.verbrauch.length === 0) return [text('Kein Verbrauchsabgleich erfasst.')];
  const bloecke = [];
  for (const doc of projekt.verbrauch) {
    bloecke.push(zwischentitel(doc.name));
    const aus = auswerten(doc, projekt, berechnet);
    if (!aus.ergebnis || aus.ergebnis.status !== 'ok') {
      const gruende = aus.ergebnis ? [FEHLER_TEXT[aus.ergebnis.grund] ?? 'Nicht berechenbar.'] : aus.meldungen.filter((m) => m.stufe === 'fehler').map((m) => m.text);
      bloecke.push(text('Dieser Abgleich ist unvollständig und wird nicht ausgewertet.'), liste(gruende.slice(0, 6)));
      continue;
    }
    const { eingabe, ergebnis, vergleich } = aus;
    bloecke.push(paare([
      ['Gasverbrauch', `${formatZahl(eingabe.gasKwh, 0)} kWh (${HS_HINWEIS})`],
      ['Davon nicht für Heizung (Warmwasser, Gasherd, Sonstiges)', `${formatZahl(eingabe.nichtFuerHeizungKwh ?? 0, 0)} kWh`],
      ['Kesselnutzungsgrad', `${bereichText(eingabe.kesselNutzungsgrad)} % (${HS_HINWEIS})`],
      ['Holz', ergebnis.holzRm > 0
        ? `${z(ergebnis.holzRm)} Rm, Heizwert ${bereichText(eingabe.heizwertRm)} kWh/Rm, Wirkungsgrad Kaminofen ${bereichText(eingabe.ofenWirkungsgrad)} %`
        : 'kein Holz'],
      ['Tatsächliche mittlere Innentemperatur im Verbrauchszeitraum (geschätzt)', `${bereichText(eingabe.innentemperaturIst)} °C`],
      ['Mittlere Soll-Innentemperatur für die Auslegung', `${z(eingabe.innentemperaturSoll)} °C`],
      ['Gewählte Heizmonate', `${eingabe.monate.filter((m) => m.heizmonat).map((m) => m.name || 'ohne Namen').join(', ')} (${formatZahl(ergebnis.gradtage.g20_15, 0)} Kd G20/15, ${formatZahl(ergebnis.gradtage.heiztage, 0)} Heiztage)`],
    ]));
    bloecke.push(tabelle(
      ['Heizlast bei Normaußentemperatur', 'von – bis (W)', 'Mittel (W)'],
      [
        ['Berechnet aus den Räumen (Gebäudeheizlast)', berechnet ? wattBereich(berechnet.min, berechnet.max).replace(' W', '') : 'nicht berechenbar', berechnet ? formatZahl(vergleich.mittelBerechnet, 0) : '–'],
        ['Abgeleitet aus dem Verbrauch', wattBereichVon(ergebnis.heizlast).replace(' W', ''), formatZahl(ergebnis.heizlast.mittel, 0)],
        ['Abweichung (Mittelwert Verbrauch gegenüber Berechnung)', '', vergleich && vergleich.abweichungProzent !== null ? mitVorzeichen(vergleich.abweichungProzent) : '–'],
      ],
      'lrr',
    ));
    if (vergleich) bloecke.push(text(vergleich.ueberlappung ? 'Die Bereiche überlappen.' : 'Die Bereiche überlappen nicht.'));
    bloecke.push(box(FREMDWAERME_HINWEIS));
    bloecke.push(zwischentitel('Annahmen und Rechenweg'));
    bloecke.push(liste(verbrauchAnnahmen(eingabe, ergebnis).filter((t) => t !== FREMDWAERME_HINWEIS)));
  }
  return bloecke;
}

function hinweiseAbschnitt(ctx) {
  const { projekt, ergebnis, hinweise } = ctx;
  const meldungen = meldungsTexte(projekt, ergebnis, hinweise).map((m) => m.text);
  const daten = inhaltsHinweise({
    zones: projekt.zonen, components: projekt.bauteile, openingTypes: projekt.oeffnungstypen,
    rooms: projekt.raeume, radiators: projekt.heizkoerper, consumption: projekt.verbrauch,
  }).map((m) => `${m.bereich} „${m.name}“: ${m.text}`);
  const bloecke = [];
  if (meldungen.length === 0 && daten.length === 0) return [text('Keine Hinweise.')];
  if (meldungen.length > 0) bloecke.push(zwischentitel('Berechnung'), liste(meldungen));
  if (daten.length > 0) bloecke.push(zwischentitel('Eingabedaten (markierte Einträge)'), liste(daten));
  return bloecke;
}

// Abweichungen eines Szenarios als Tabelle mit Ist- und Szenario-Wert nebeneinander.
function abweichungsBloecke(info) {
  const bloecke = [];
  if (info.beschreibung) bloecke.push(text(info.beschreibung));
  if (info.kosten && (kostenEingetragen(info.kosten.investition) || kostenEingetragen(info.kosten.foerderung))) {
    const nach = kostenNachFoerderung(info.kosten);
    bloecke.push(paare([
      ['Investitionskosten', kostenEingetragen(info.kosten.investition) ? bandText(info.kosten.investition, 0, '€') : 'nicht angegeben'],
      ['Förderung', kostenEingetragen(info.kosten.foerderung) ? bandText(info.kosten.foerderung, 0, '€') : 'nicht angegeben'],
      ['Kosten nach Förderung', nach ? bandText(nach, 0, '€') : '–'],
      ['Quelle der Kosten', info.kosten.quelle || 'nicht angegeben'],
    ]));
  }
  bloecke.push(info.zeilen.length === 0
    ? text('Keine Abweichungen: Das Szenario entspricht dem Ist-Zustand.')
    : tabelle(['Bereich', 'Ziel', 'Ist-Zustand', 'Szenario'], info.zeilen.map((r) => [r.bereich, r.hinweis ? `${r.ziel} (Ziel fehlt im Ist-Zustand)` : r.ziel, r.ist, r.szenario]), 'llll'));
  if (info.hinweise.length > 0) bloecke.push(box(`Abweichungen ohne Wirkung: ${info.hinweise.map((h) => h.text).join(' ')}`, 'fehler'));
  return bloecke;
}

// --- Gesamtbericht ---------------------------------------------------------------------------

// optionen.szenario: Angaben zu einem aktiven Szenario (siehe szenarioInfo). Dann gilt der Bericht für dieses Szenario:
// projekt enthält die angewendeten Abweichungen, der Verbrauchsabgleich entfällt, ein Abschnitt listet die Abweichungen.
export function baueBericht(projekt, jetzt = new Date(), optionen = {}) {
  const szenario = optionen.szenario ?? null;
  const e = projekt.einstellungen;
  const { ergebnis, hinweise, fehler } = rechne(projekt);
  const berechnet = berechneteBandbreite(ergebnis);
  const ziel = e.zielVorlauf ?? 45;
  const bewertung = ergebnis ? bewerteVorlauf(projekt, ergebnis, ziel) : null;
  const ctx = { projekt, ergebnis, hinweise, fehler, bewertung, berechnet, ziel };
  const hatErgebnis = Boolean(ergebnis) && ergebnis.raeume.length > 0;

  const abschnitte = [
    {
      titel: 'Ergebnis auf einen Blick',
      bloecke: [
        ...(szenario ? [box(`Dieser Bericht gilt für das Szenario „${szenario.name}“, nicht für den Ist-Zustand. Alle Werte enthalten die Abweichungen des Szenarios.`)] : []),
        ...uebersicht(ctx).map((b) => (szenario && b.art === 'paare' ? { ...b, zeilen: b.zeilen.filter((r) => !r[0].startsWith('Verbrauchsabgleich')) } : b)),
      ],
    },
    ...(szenario ? [{ titel: `Szenario „${szenario.name}“: Abweichungen`, bloecke: abweichungsBloecke(szenario) }] : []),
    { titel: 'Projektdaten und Einstellungen', bloecke: projektdaten(projekt) },
    { titel: 'Verfahren und Annahmen', bloecke: verfahren(projekt) },
    { titel: 'Zonen', bloecke: zonenAbschnitt(projekt) },
    { titel: 'Bauteilkatalog', bloecke: bauteileAbschnitt(projekt) },
    { titel: 'Öffnungstypen', bloecke: oeffnungenAbschnitt(projekt) },
    ...(hatErgebnis ? [{ titel: 'Räume und Heizlast', bloecke: raeumeAbschnitt(ctx) }] : []),
    { titel: 'Heizkörper', bloecke: heizkoerperAbschnitt(projekt) },
    ...(hatErgebnis ? [{ titel: 'Vorlauftemperaturen', bloecke: vorlaufAbschnitt(ctx) }] : []),
    { titel: 'Verbrauchsabgleich', bloecke: szenario ? [text('Im Szenario-Bericht entfällt der Verbrauchsabgleich: Er vergleicht den gemessenen Verbrauch mit dem Ist-Zustand. Siehe den Bericht „Ist-Zustand“.')] : verbrauchAbschnitt(ctx) },
    { titel: 'Hinweise und Datenqualität', bloecke: hinweiseAbschnitt(ctx) },
    ...(projekt.raeume.length > 0 ? [{ titel: 'Plan und Vollständigkeit', neueSeite: true, bloecke: planAbschnitt(ctx) }] : []),
    ...(hatErgebnis ? [{ titel: 'Anlage: Raumflächen und Verluste', neueSeite: true, bloecke: flaechenAnlage(ctx) }] : []),
  ].map((a, i) => ({ ...a, titel: `${i + 1} ${a.titel}` }));

  const datum = datumText(jetzt);
  const name = e.projektname || 'Heizlast';
  return {
    titel: szenario ? 'Heizlastberechnung: Prüfbericht (Szenario)' : 'Heizlastberechnung: Prüfbericht',
    projektname: `${e.projektname || 'ohne Namen'}${szenario ? ` · Szenario: ${szenario.name}` : ''}`,
    erstelltAm: datum,
    haftungshinweis: HAFTUNGSHINWEIS,
    seitentitel: `Heizlast-Bericht ${name}${szenario ? ` Szenario ${szenario.name}` : ''} ${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`,
    abschnitte,
  };
}



// Bericht „Szenarienvergleich“: Kennzahlen, Räume, Verluste nach Art und die Abweichungen je Szenario.
// ist: Projekt im Ist-Zustand, szenarien: alle Szenarien.
export function baueVergleichsBericht(ist, szenarien, jetzt = new Date()) {
  const e = ist.einstellungen;
  const vergleich = baueVergleich(ist, szenarien);
  const t = vergleichTabellen(vergleich);
  const tab = (x) => tabelle(x.kopf, x.zeilen, x.ausrichtung, Boolean(x.summenzeile), x.hervor ?? []);
  const hinweise = vergleich.spalten.filter((sp) => sp.szenarioHinweise.length > 0);

  const abschnitte = [
    {
      titel: 'Szenarienvergleich',
      bloecke: [
        text('Der Ist-Zustand und jedes Szenario nebeneinander. Die Gebäudeheizlast ist eine Bandbreite von der günstigen bis zur ungünstigen Rechnung. '
          + 'Die Minderung bezieht sich auf den Mittelwert, die Vorlauftemperatur des Hauses auf die ungünstige Heizlast.'),
        ...(szenarien.length === 0 ? [text('Es gibt noch keine Szenarien.')] : [
          tab(t.kennzahlen),
          zwischentitel('Jahreswärme-Differenz gegenüber dem Ist-Zustand'),
          box(t.jahreswaerme.hinweis),
          tab(t.jahreswaerme),
          liste(t.jahreswaerme.annahmen),
          ...(hinweise.length > 0 ? [box(`Abweichungen ohne Wirkung: ${hinweise.map((sp) => `${sp.name}: ${sp.szenarioHinweise.map((h) => h.text).join(' ')}`).join(' ')}`, 'fehler')] : []),
        ]),
      ],
    },
    ...(szenarien.length > 0 ? [
      { titel: 'Räume im Vergleich', bloecke: [text('Heizlast als Mittelwert und nötige Vorlauftemperatur (ungünstige Heizlast) je Raum.'), tab(t.raeume)] },
      {
        titel: 'Woher kommt die Änderung? Verluste nach Art',
        bloecke: [
          text('Mittelwert aus günstiger und ungünstiger Rechnung. In Klammern die Änderung gegenüber dem Ist-Zustand. Raum-zu-Raum-Ströme bleiben im Haus und sind nicht enthalten, die Summe entspricht der Gebäudeheizlast.'),
          tab(t.transmission),
        ],
      },
      {
        titel: 'Abweichungen je Szenario',
        neueSeite: true,
        bloecke: szenarien.flatMap((sz) => [zwischentitel(sz.name), ...abweichungsBloecke(szenarioInfo(ist, sz))]),
      },
    ] : []),
  ].map((a, i) => ({ ...a, titel: `${i + 1} ${a.titel}` }));

  const name = e.projektname || 'Heizlast';
  return {
    titel: 'Heizlastberechnung: Szenarienvergleich',
    projektname: e.projektname || 'ohne Namen',
    erstelltAm: datumText(jetzt),
    haftungshinweis: HAFTUNGSHINWEIS,
    seitentitel: `Heizlast-Szenarienvergleich ${name} ${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`,
    abschnitte,
  };
}
