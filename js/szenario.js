// Szenarien: Abweichungen gegenüber dem Ist-Zustand. Reine Funktionen ohne Oberfläche und ohne Datenbank.
//
// Der Ist-Zustand sind die normalen Projektdaten. Ein Szenario ändert sie nie. Es beschreibt nur Abweichungen, und
// wendeSzenarioAn() baut daraus eine veränderte KOPIE des Projekts. Alle Berechnungen, Ansichten und der Bericht
// arbeiten mit dieser Kopie, das Original bleibt unberührt.
//
// Ein Szenario: {
//   id, name, beschreibung, erstelltAm,
//   abweichungen: {
//     bauteile:            { [bauteilId]:    { name, u: { min, max } } },        U-Wert-Spanne in W/(m²K)
//     oeffnungstypen:      { [typId]:        { name, uw } },                     Uw in W/(m²K)
//     heizkoerperStatus:   { [heizkoerperId]: { name, status } },                bleibt | entfaellt | neu | geplant
//     neueHeizkoerper:     [ { id, raumId, bauart, ... } ],                      nur in diesem Szenario vorhanden
//     raumTemperatur:      { [raumId]:       { name, theta } },                  Soll-Temperatur in °C
//     luftwechselStandard: { min, max } | null,                                  Standard-Luftwechsel in 1/h
//     luftwechselRaum:     { [raumId]:       { name, min, max } },               Luftwechsel des Raums in 1/h
//     einstellungen:       { zielVorlauf?, spreizung? },
//   },
// }
// "name" in den Einträgen ist eine Merkhilfe (Name beim Anlegen), damit ein Hinweis auch dann verständlich bleibt,
// wenn das Ziel im Ist-Zustand gelöscht wurde.

import { zahlZuText } from './engine/format.js';
import { kennlinieZuText } from './modell.js';
import { label, HK_STATI, BAUARTEN_HK, VENTILE, werte } from './schemas.js';
import { pruefeZahl, pruefeBereich, fehlerMeldung } from './validate.js';
import { validiereHeizkoerper } from './validate.js';

const z = zahlZuText;
const istZahl = (x) => typeof x === 'number' && Number.isFinite(x);
const kopie = (x) => JSON.parse(JSON.stringify(x));
const bereichText = (b) => (b.min === b.max ? z(b.min) : `${z(b.min)} – ${z(b.max)}`);

export const leereAbweichungen = () => ({
  bauteile: {},
  oeffnungstypen: {},
  heizkoerperStatus: {},
  neueHeizkoerper: [],
  raumTemperatur: {},
  luftwechselStandard: null,
  luftwechselRaum: {},
  einstellungen: {},
});

export function neuesSzenario(id, name = 'Neues Szenario', jetzt = new Date()) {
  return { id, name, beschreibung: '', erstelltAm: jetzt.toISOString(), abweichungen: leereAbweichungen() };
}

// Ergänzt fehlende Teile (zum Beispiel aus einer Datei) mit Leerwerten. Gibt immer ein vollständiges Szenario zurück.
export function normalisiereSzenario(roh) {
  const a = roh?.abweichungen ?? {};
  const objekt = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return {
    ...roh,
    name: typeof roh?.name === 'string' ? roh.name : '',
    beschreibung: typeof roh?.beschreibung === 'string' ? roh.beschreibung : '',
    erstelltAm: typeof roh?.erstelltAm === 'string' ? roh.erstelltAm : null,
    abweichungen: {
      bauteile: objekt(a.bauteile),
      oeffnungstypen: objekt(a.oeffnungstypen),
      heizkoerperStatus: objekt(a.heizkoerperStatus),
      neueHeizkoerper: Array.isArray(a.neueHeizkoerper) ? a.neueHeizkoerper : [],
      raumTemperatur: objekt(a.raumTemperatur),
      luftwechselStandard: a.luftwechselStandard && typeof a.luftwechselStandard === 'object' ? a.luftwechselStandard : null,
      luftwechselRaum: objekt(a.luftwechselRaum),
      einstellungen: objekt(a.einstellungen),
    },
  };
}

// Kopie mit neuer Kennung. Neue Heizkörper des Szenarios bekommen ebenfalls neue Kennungen, damit sie sich
// nicht mit denen des Originals überschneiden (spätere Fotomarkierungen verweisen auf Heizkörper-Ids).
export function kopiereSzenario(szenario, neueId, name = null, jetzt = new Date()) {
  const k = kopie(normalisiereSzenario(szenario));
  k.id = neueId();
  k.name = name ?? `${szenario.name} (Kopie)`;
  k.erstelltAm = jetzt.toISOString();
  k.abweichungen.neueHeizkoerper = k.abweichungen.neueHeizkoerper.map((h) => ({ ...h, id: neueId() }));
  return k;
}

export const benenneUm = (szenario, name, beschreibung = szenario.beschreibung) => ({ ...szenario, name, beschreibung });
export const loescheSzenario = (liste, id) => liste.filter((s) => s.id !== id);

// --- Anwenden ------------------------------------------------------------------------------------

// Baut aus dem Ist-Projekt (Form wie ladeProjekt()) eine veränderte Kopie. Das Original bleibt unverändert.
// Rückgabe: { projekt, hinweise: [{ art, ziel, text }] }. Abweichungen, deren Ziel im Ist-Zustand fehlt,
// werden nicht angewendet und als Hinweis gemeldet.
export function wendeSzenarioAn(ist, szenario) {
  const a = normalisiereSzenario(szenario).abweichungen;
  const hinweise = [];
  const fehlt = (art, ziel, name, was) => hinweise.push({ art, ziel, text: `${was} „${name ?? ziel}“ gibt es im Ist-Zustand nicht mehr. Die Abweichung wird nicht angewendet.` });

  const bauteileIds = new Set(ist.bauteile.map((b) => b.id));
  for (const [id, ov] of Object.entries(a.bauteile)) if (!bauteileIds.has(id)) fehlt('bauteil_fehlt', id, ov.name, 'Das Bauteil');
  const typIds = new Set(ist.oeffnungstypen.map((t) => t.id));
  for (const [id, ov] of Object.entries(a.oeffnungstypen)) if (!typIds.has(id)) fehlt('oeffnungstyp_fehlt', id, ov.name, 'Der Öffnungstyp');
  const hkIds = new Set(ist.heizkoerper.map((h) => h.id));
  for (const [id, ov] of Object.entries(a.heizkoerperStatus)) if (!hkIds.has(id)) fehlt('heizkoerper_fehlt', id, ov.name, 'Der Heizkörper');
  const raumIds = new Set(ist.raeume.map((r) => r.id));
  for (const [id, ov] of Object.entries(a.raumTemperatur)) if (!raumIds.has(id)) fehlt('raum_fehlt', id, ov.name, 'Der Raum');
  for (const [id, ov] of Object.entries(a.luftwechselRaum)) if (!raumIds.has(id)) fehlt('raum_fehlt', id, ov.name, 'Der Raum');

  const neue = [];
  for (const h of a.neueHeizkoerper) {
    if (!raumIds.has(h.raumId)) {
      hinweise.push({ art: 'raum_fehlt', ziel: h.id, text: `Der Raum für den szenario-eigenen Heizkörper „${h.name || h.id}“ gibt es im Ist-Zustand nicht mehr. Der Heizkörper wird nicht angewendet.` });
    } else if (hkIds.has(h.id)) {
      hinweise.push({ art: 'id_doppelt', ziel: h.id, text: `Die Kennung des szenario-eigenen Heizkörpers „${h.name || h.id}“ gibt es im Ist-Zustand schon. Der Heizkörper wird nicht angewendet.` });
    } else {
      neue.push({ ...kopie(h), szenarioEigen: true });
    }
  }

  const bereichOk = (b) => b && istZahl(b.min) && istZahl(b.max);
  const projekt = {
    ...ist,
    einstellungen: {
      ...ist.einstellungen,
      ...(bereichOk(a.luftwechselStandard) ? { luftwechselStandard: { min: a.luftwechselStandard.min, max: a.luftwechselStandard.max } } : {}),
      ...(istZahl(a.einstellungen.zielVorlauf) ? { zielVorlauf: a.einstellungen.zielVorlauf } : {}),
      ...(istZahl(a.einstellungen.spreizung) ? { spreizung: a.einstellungen.spreizung } : {}),
    },
    bauteile: ist.bauteile.map((b) => (bereichOk(a.bauteile[b.id]?.u) ? { ...b, u: { min: a.bauteile[b.id].u.min, max: a.bauteile[b.id].u.max } } : b)),
    oeffnungstypen: ist.oeffnungstypen.map((t) => (istZahl(a.oeffnungstypen[t.id]?.uw) ? { ...t, uw: a.oeffnungstypen[t.id].uw } : t)),
    raeume: ist.raeume.map((r) => {
      let neu = r;
      if (istZahl(a.raumTemperatur[r.id]?.theta)) neu = { ...neu, theta: a.raumTemperatur[r.id].theta };
      if (bereichOk(a.luftwechselRaum[r.id])) neu = { ...neu, luftwechsel: { min: a.luftwechselRaum[r.id].min, max: a.luftwechselRaum[r.id].max } };
      return neu;
    }),
    heizkoerper: [
      ...ist.heizkoerper.map((h) => (werte(HK_STATI).includes(a.heizkoerperStatus[h.id]?.status) ? { ...h, status: a.heizkoerperStatus[h.id].status } : h)),
      ...neue,
    ],
  };
  return { projekt, hinweise };
}

// --- Beschreibung der Abweichungen (Editor, Bericht) -----------------------------------------------

const uText = (u) => `${bereichText(u)} W/(m²K)`;
const hkName = (h, raumName) => `${label(BAUARTEN_HK, h.bauart)}${raumName ? ` in „${raumName}“` : ''}`;

// Liste der Abweichungen mit Ist- und Szenario-Wert nebeneinander.
// Zeile: { bereich, schluessel: { typ, id }, ziel, ist, szenario, hinweis }. ist ist null, wenn das Ziel fehlt.
export function beschreibeAbweichungen(ist, szenario) {
  const a = normalisiereSzenario(szenario).abweichungen;
  const zeilen = [];
  const raumName = (id) => ist.raeume.find((r) => r.id === id)?.name ?? null;
  const fehlend = 'nicht mehr vorhanden';
  const hinweisFehlt = (was) => `${was} gibt es im Ist-Zustand nicht mehr, die Abweichung wirkt nicht.`;

  for (const [id, ov] of Object.entries(a.bauteile)) {
    const b = ist.bauteile.find((x) => x.id === id);
    zeilen.push({ bereich: 'Bauteil (U-Wert)', schluessel: { typ: 'bauteile', id }, ziel: b?.name ?? ov.name ?? id, ist: b ? uText(b.u) : fehlend, szenario: bereichOk(ov.u) ? uText(ov.u) : 'ungültig', hinweis: b ? null : hinweisFehlt('Das Bauteil') });
  }
  for (const [id, ov] of Object.entries(a.oeffnungstypen)) {
    const t = ist.oeffnungstypen.find((x) => x.id === id);
    zeilen.push({ bereich: 'Öffnungstyp (Uw)', schluessel: { typ: 'oeffnungstypen', id }, ziel: t?.name ?? ov.name ?? id, ist: t ? `${z(t.uw)} W/(m²K)` : fehlend, szenario: istZahl(ov.uw) ? `${z(ov.uw)} W/(m²K)` : 'ungültig', hinweis: t ? null : hinweisFehlt('Der Öffnungstyp') });
  }
  for (const [id, ov] of Object.entries(a.heizkoerperStatus)) {
    const h = ist.heizkoerper.find((x) => x.id === id);
    zeilen.push({ bereich: 'Heizkörper (Status)', schluessel: { typ: 'heizkoerperStatus', id }, ziel: h ? hkName(h, raumName(h.raumId)) : (ov.name ?? id), ist: h ? label(HK_STATI, h.status) : fehlend, szenario: label(HK_STATI, ov.status), hinweis: h ? null : hinweisFehlt('Der Heizkörper') });
  }
  a.neueHeizkoerper.forEach((h) => {
    const ok = ist.raeume.some((r) => r.id === h.raumId);
    zeilen.push({ bereich: 'Neuer Heizkörper', schluessel: { typ: 'neueHeizkoerper', id: h.id }, ziel: hkName(h, raumName(h.raumId) ?? 'Raum fehlt'), ist: 'nicht vorhanden', szenario: `${label(HK_STATI, h.status)}, ${h.bauart === 'wp' ? 'Kennlinie' : `${z(h.normleistung ?? 0)} W`}`, hinweis: ok ? null : hinweisFehlt('Der Raum') });
  });
  for (const [id, ov] of Object.entries(a.raumTemperatur)) {
    const r = ist.raeume.find((x) => x.id === id);
    zeilen.push({ bereich: 'Raum (Soll-Temperatur)', schluessel: { typ: 'raumTemperatur', id }, ziel: r?.name ?? ov.name ?? id, ist: r ? `${z(r.theta)} °C` : fehlend, szenario: istZahl(ov.theta) ? `${z(ov.theta)} °C` : 'ungültig', hinweis: r ? null : hinweisFehlt('Der Raum') });
  }
  if (a.luftwechselStandard) {
    zeilen.push({ bereich: 'Luftwechsel (Standard)', schluessel: { typ: 'luftwechselStandard', id: null }, ziel: 'alle Räume ohne eigenen Wert', ist: `${bereichText(ist.einstellungen.luftwechselStandard)} 1/h`, szenario: bereichOk(a.luftwechselStandard) ? `${bereichText(a.luftwechselStandard)} 1/h` : 'ungültig', hinweis: null });
  }
  for (const [id, ov] of Object.entries(a.luftwechselRaum)) {
    const r = ist.raeume.find((x) => x.id === id);
    zeilen.push({ bereich: 'Raum (Luftwechsel)', schluessel: { typ: 'luftwechselRaum', id }, ziel: r?.name ?? ov.name ?? id, ist: r ? (r.luftwechsel ? `${bereichText(r.luftwechsel)} 1/h` : `Standard (${bereichText(ist.einstellungen.luftwechselStandard)} 1/h)`) : fehlend, szenario: bereichOk(ov) ? `${bereichText(ov)} 1/h` : 'ungültig', hinweis: r ? null : hinweisFehlt('Der Raum') });
  }
  if (istZahl(a.einstellungen.zielVorlauf)) {
    zeilen.push({ bereich: 'Einstellung', schluessel: { typ: 'einstellungen', id: 'zielVorlauf' }, ziel: 'Ziel-Vorlauftemperatur', ist: `${z(ist.einstellungen.zielVorlauf ?? 45)} °C`, szenario: `${z(a.einstellungen.zielVorlauf)} °C`, hinweis: null });
  }
  if (istZahl(a.einstellungen.spreizung)) {
    zeilen.push({ bereich: 'Einstellung', schluessel: { typ: 'einstellungen', id: 'spreizung' }, ziel: 'Spreizung Vor-/Rücklauf', ist: `${z(ist.einstellungen.spreizung)} K`, szenario: `${z(a.einstellungen.spreizung)} K`, hinweis: null });
  }
  return zeilen;
  function bereichOk(b) { return b && istZahl(b.min) && istZahl(b.max); }
}

// --- Prüfung -------------------------------------------------------------------------------------

// Meldungen { feld, stufe, text } zu einem Szenario beim Speichern im Editor.
export function validiereSzenario(szenario) {
  const a = normalisiereSzenario(szenario).abweichungen;
  const meldungen = [];
  if (!szenario.name || szenario.name.trim() === '') meldungen.push(fehlerMeldung('name', 'Szenario: bitte einen Namen eingeben.'));
  for (const [id, ov] of Object.entries(a.bauteile)) {
    meldungen.push(...pruefeBereich(`bauteile.${id}`, ov.u, { name: `U-Wert „${ov.name ?? id}“`, einheit: 'W/(m²K)', fehlerWennKleinerGleich: 0, warnWennUeber: 6, warnWennUnter: 0.05 }));
  }
  for (const [id, ov] of Object.entries(a.oeffnungstypen)) {
    meldungen.push(...pruefeZahl(`oeffnungstypen.${id}`, ov.uw, { name: `Uw „${ov.name ?? id}“`, einheit: 'W/(m²K)', fehlerWennKleinerGleich: 0, warnWennUeber: 6, warnWennUnter: 0.3 }));
  }
  for (const [id, ov] of Object.entries(a.raumTemperatur)) {
    meldungen.push(...pruefeZahl(`raumTemperatur.${id}`, ov.theta, { name: `Soll-Temperatur „${ov.name ?? id}“`, einheit: '°C', warnWennUeber: 30, warnWennUnter: 5 }));
  }
  if (a.luftwechselStandard) {
    meldungen.push(...pruefeBereich('luftwechselStandard', a.luftwechselStandard, { name: 'Standard-Luftwechsel', einheit: '1/h', fehlerWennKleiner: 0, warnWennUeber: 3 }));
  }
  for (const [id, ov] of Object.entries(a.luftwechselRaum)) {
    meldungen.push(...pruefeBereich(`luftwechselRaum.${id}`, ov, { name: `Luftwechsel „${ov.name ?? id}“`, einheit: '1/h', fehlerWennKleiner: 0, warnWennUeber: 3 }));
  }
  if (a.einstellungen.zielVorlauf !== undefined) {
    meldungen.push(...pruefeZahl('einstellungen.zielVorlauf', a.einstellungen.zielVorlauf, { name: 'Ziel-Vorlauftemperatur', einheit: '°C', fehlerWennKleinerGleich: 0, warnWennUeber: 75, warnWennUnter: 25 }));
  }
  if (a.einstellungen.spreizung !== undefined) {
    meldungen.push(...pruefeZahl('einstellungen.spreizung', a.einstellungen.spreizung, { name: 'Spreizung', einheit: 'K', fehlerWennKleinerGleich: 0, warnWennUeber: 20 }));
  }
  const optionen = { bauarten: werte(BAUARTEN_HK), stati: werte(HK_STATI), ventile: werte(VENTILE) };
  for (const h of a.neueHeizkoerper) {
    for (const m of validiereHeizkoerper({ ...h, kennlinieText: kennlinieZuText(h.kennlinie) }, optionen)) {
      meldungen.push({ ...m, feld: `neueHeizkoerper.${h.id}.${m.feld}` });
    }
  }
  return meldungen;
}

// Zahl der Abweichungen (für Listen).
export function zaehleAbweichungen(szenario) {
  const a = normalisiereSzenario(szenario).abweichungen;
  return Object.keys(a.bauteile).length + Object.keys(a.oeffnungstypen).length + Object.keys(a.heizkoerperStatus).length
    + a.neueHeizkoerper.length + Object.keys(a.raumTemperatur).length + (a.luftwechselStandard ? 1 : 0)
    + Object.keys(a.luftwechselRaum).length + Object.keys(a.einstellungen).length;
}

// Angaben zu einem Szenario für den Bericht: Name, Beschreibung, Abweichungen (Ist- und Szenario-Wert) und Hinweise.
export function szenarioInfo(ist, szenario) {
  const s = normalisiereSzenario(szenario);
  return { name: s.name, beschreibung: s.beschreibung, zeilen: beschreibeAbweichungen(ist, s), hinweise: wendeSzenarioAn(ist, s).hinweise };
}
