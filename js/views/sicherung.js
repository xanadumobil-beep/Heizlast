// Sicherung: Export als JSON-Datei (Teilen-Menü, Dateien-App) und Import mit Warnung vor dem Überschreiben.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { aktualisiereBanner } from '../banner.js';
import { bytesText } from '../foto.js';
import { baueExportBlob, dateiFotosZuBlobs, schaetzeExportGroesse } from '../fotoexport.js';
import {
  baueExport, exportText, exportDateiname, pruefeImport, zusammenfassung, ZUSAMMENFASSUNG_NAMEN,
  sicherungsStatus, datumText, SICHERUNG_FRIST_TAGE,
} from '../io.js';

// Gibt die Datei an das Teilen-Menü (iPad: „In Dateien sichern“) oder, wenn das nicht geht, als Download.
// Rückgabe: 'geteilt' | 'download' | 'abgebrochen'.
// Die Datei ist vorher fertig gebaut: Safari verlangt, dass das Teilen unmittelbar auf den Tipp folgt.
async function gibDateiAus(datei) {
  if (navigator.share && navigator.canShare?.({ files: [datei] })) {
    try {
      await navigator.share({ files: [datei], title: 'Heizlast-Sicherung' });
      return 'geteilt';
    } catch (fehler) {
      if (fehler.name === 'AbortError') return 'abgebrochen';
      // Andere Fehler: weiter mit dem Download.
    }
  }
  const adresse = URL.createObjectURL(datei);
  const link = el('a', { href: adresse, download: datei.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 30000);
  return 'download';
}

function zusammenfassungsTabelle(datei, aktuell) {
  const schluessel = Object.keys(ZUSAMMENFASSUNG_NAMEN);
  return el(
    'table', { class: 'tabelle' },
    el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', { class: 'zahl' }, 'In der Datei'), el('th', { class: 'zahl' }, 'Jetzt in der App'))),
    el('tbody', {}, schluessel.map((k) => el(
      'tr', {},
      el('th', { scope: 'row' }, ZUSAMMENFASSUNG_NAMEN[k]),
      el('td', { class: 'zahl' }, String(datei[k])),
      el('td', { class: 'zahl' }, String(aktuell[k])),
    ))),
  );
}

function begrenzteListe(titel, eintraege, max = 10) {
  if (eintraege.length === 0) return null;
  return el(
    'div', { class: 'hinweisliste' },
    el('p', { class: 'beschriftung' }, `${titel} (${eintraege.length})`),
    el('ul', {}, eintraege.slice(0, max).map((t) => el('li', {}, t))),
    eintraege.length > max ? el('p', { class: 'zeile' }, `… und ${eintraege.length - max} weitere`) : null,
  );
}

export async function renderSicherung(container) {
  const [speicher, sicherung, start] = await Promise.all([db.ladeAlles(), db.ladeSicherung(), db.lade('meta', 'init')]);
  const fotoStand = await db.fotoSpeicher();
  const aktuell = zusammenfassung(speicher);
  const jetzt = new Date();
  const groesse = schaetzeExportGroesse(speicher, jetzt);
  const dateinameMitFotos = exportDateiname(jetzt).replace(/\.json$/, '-mit-fotos.json');
  const dateiname = exportDateiname(jetzt);
  const datei = new File([exportText(baueExport(speicher, jetzt))], dateiname, { type: 'application/json' });

  const statusZeile = el('p', { class: 'zeile', 'aria-live': 'polite' });
  const exportRueckmeldung = el('p', { class: 'ok', 'aria-live': 'polite' });
  const vorschau = el('div', { 'aria-live': 'polite' });

  const zeigeStatus = (letzte) => {
    const status = sicherungsStatus({ jetzt: new Date(), letzteSicherung: letzte?.zeit ?? null, start: start?.datum ?? null });
    statusZeile.textContent = status.nie
      ? `Noch nie gesichert. Die App wird seit ${status.tage} Tag${status.tage === 1 ? '' : 'en'} genutzt.`
      : `Letzte Sicherung: ${datumText(status.referenz)}, vor ${status.tage} Tag${status.tage === 1 ? '' : 'en'}.`
        + (status.ueberfaellig ? ` Das ist älter als ${SICHERUNG_FRIST_TAGE} Tage.` : '');
    statusZeile.className = status.ueberfaellig ? 'meldung warnung' : 'zeile';
  };
  zeigeStatus(sicherung);

  async function sichere(zuGeben = datei, name = dateiname) {
    const ergebnis = await gibDateiAus(zuGeben);
    if (ergebnis === 'abgebrochen') {
      exportRueckmeldung.textContent = '';
      return false;
    }
    const neu = { zeit: new Date().toISOString(), art: 'export', dateiname: name };
    await db.speichereSicherung(neu);
    zeigeStatus(neu);
    exportRueckmeldung.textContent = ergebnis === 'geteilt'
      ? 'Sicherung übergeben. Im Teilen-Menü „In Dateien sichern“ wählen und einen Ordner in iCloud Drive aussuchen.'
      : `Die Datei „${name}“ wurde heruntergeladen. Sie liegt im Download-Ordner des Browsers.`;
    aktualisiereBanner();
    return true;
  }

  async function ersetze(pruefung, name, behalteFotosFeld = null) {
    const jetztDaten = zusammenfassung(speicher);
    const neu = pruefung.zusammenfassung;
    const frage = `Alle aktuellen Daten ersetzen?\n\nJetzt in der App: ${jetztDaten.raeume} Räume, ${jetztDaten.raumflaechen} Raumflächen, ${jetztDaten.heizkoerper} Heizkörper.\n`
      + `Aus der Datei: ${neu.raeume} Räume, ${neu.raumflaechen} Raumflächen, ${neu.heizkoerper} Heizkörper.\n\n`
      + 'Das lässt sich nicht rückgängig machen.';
    const dateiHatFotos = neu.fotos > 0 || neu.hintergruende > 0;
    const behalteFotos = !dateiHatFotos && Boolean(behalteFotosFeld?.checked);
    const fotoText = dateiHatFotos
      ? `Die Fotos und Baupläne der App werden durch die ${neu.fotos} Foto(s) und ${neu.hintergruende} Bauplan/Baupläne aus der Datei ersetzt.\n\n`
      : behalteFotos ? 'Die vorhandenen Fotos, Markierungen und Baupläne bleiben erhalten.\n\n'
        : (fotoStand.fotos + fotoStand.hintergruende > 0 ? `ACHTUNG: Die ${fotoStand.fotos} vorhandenen Fotos und ${fotoStand.hintergruende} Bauplan/Baupläne werden gelöscht.\n\n` : '');
    if (!confirm(`${frage}\n\n${fotoText}`.trim())) return;
    const eintrag = { zeit: pruefung.exportiertAm ?? new Date().toISOString(), art: 'import', dateiname: name };
    try {
      const daten = dateiHatFotos ? dateiFotosZuBlobs(pruefung.daten).speicher : pruefung.daten;
      await db.ersetzeAlles(daten, eintrag, { behalteFotos });
    } catch (fehler) {
      ersetzeKinder(vorschau, el('p', { class: 'meldung fehler' }, `Der Import ist fehlgeschlagen, die bisherigen Daten sind unverändert: ${fehler.message}`));
      return;
    }
    ersetzeKinder(
      vorschau,
      el(
        'section', { class: 'karte' },
        el('h3', {}, 'Import abgeschlossen'),
        el('p', { class: 'ok' }, `Geladen: ${neu.raeume} Räume, ${neu.raumflaechen} Raumflächen, ${neu.heizkoerper} Heizkörper, ${neu.verbrauch} Verbrauchsabgleiche.`),
        el('div', { class: 'knopfzeile' }, el('a', { class: 'knopf primaer', href: '#raeume' }, 'Zu den Räumen')),
      ),
    );
    zeigeStatus(eintrag);
    aktualisiereBanner();
  }

  // Fotos in der Datei und in der App. Hat die Datei keine Fotos, lassen sich die vorhandenen auf Wunsch behalten.
  let behalteFeld = null;
  function fotoBlock(pruefung) {
    const info = pruefung.fotoInfo;
    behalteFeld = null;
    if (info.fotos + info.hintergruende > 0) {
      return el('p', { class: 'zeile' }, `Die Datei enthält ${info.fotos} Foto(s) und ${info.hintergruende} Bauplan/Baupläne (ca. ${bytesText(info.bytes)}). Sie ersetzen die Fotos und Baupläne in der App.`);
    }
    if (fotoStand.fotos + fotoStand.hintergruende === 0) return el('p', { class: 'zeile' }, 'Die Datei enthält keine Fotos. In der App gibt es auch keine.');
    behalteFeld = el('input', { type: 'checkbox', checked: true, 'aria-label': 'Vorhandene Fotos behalten' });
    return el(
      'label', { class: 'behalten' },
      behalteFeld,
      ` Die Datei enthält keine Fotos. Die ${fotoStand.fotos} vorhandenen Fotos, ihre Markierungen und ${fotoStand.hintergruende} Bauplan/Baupläne (${bytesText(fotoStand.bytes)}) behalten. Ohne Haken werden sie gelöscht.`,
    );
  }

  function zeigeVorschau(pruefung, name) {
    if (!pruefung.ok) {
      ersetzeKinder(
        vorschau,
        el(
          'section', { class: 'karte markiert' },
          el('h3', {}, 'Diese Datei lässt sich nicht importieren'),
          el('ul', {}, pruefung.fehler.map((f) => el('li', { class: 'meldung fehler' }, f))),
          el('p', { class: 'zeile' }, 'Es wurde nichts verändert.'),
        ),
      );
      return;
    }
    ersetzeKinder(
      vorschau,
      el(
        'section', { class: 'karte' },
        el('h3', {}, `Datei „${name}“`),
        el('p', { class: 'zeile' }, pruefung.exportiertAm ? `Gesichert am ${datumText(pruefung.exportiertAm)}.` : 'Ohne Datum der Sicherung.'),
        zusammenfassungsTabelle(pruefung.zusammenfassung, aktuell),
        el(
          'p', { class: 'hinweisbox', role: 'alert' },
          el('strong', {}, 'Achtung: '),
          'Beim Import werden alle aktuellen Daten ersetzt. Das lässt sich nicht rückgängig machen. Sichere die aktuellen Daten vorher.',
        ),
        fotoBlock(pruefung),
        begrenzteListe('Verweise ohne Ziel', pruefung.verweise),
        begrenzteListe(
          'Einträge mit Hinweisen (werden importiert und markiert)',
          pruefung.inhalt.map((m) => `${m.bereich} „${m.name}“: ${m.text}`),
        ),
        el(
          'div', { class: 'knopfzeile' },
          el('button', { type: 'button', onClick: () => sichere() }, 'Aktuelle Daten zuerst sichern'),
          el('button', { type: 'button', class: 'gefahr', onClick: () => ersetze(pruefung, name, behalteFeld) }, 'Daten ersetzen'),
          el('button', { type: 'button', onClick: () => ersetzeKinder(vorschau) }, 'Abbrechen'),
        ),
      ),
    );
  }

  // Export mit Fotos: Die Datei wird zuerst gebaut (mit Fortschritt), danach folgt ein eigener Tipp zum Sichern, denn das
  // Teilen-Menü verlangt, dass es unmittelbar auf einen Tipp folgt.
  function fotoExportBlock() {
    if (fotoStand.fotos + fotoStand.hintergruende === 0) return el('p', { class: 'zeile' }, 'Es gibt noch keine Fotos oder Baupläne in der App.');
    const fortschritt = el('p', { class: 'zeile', 'aria-live': 'polite' });
    const bereit = el('div', { class: 'knopfzeile' });
    const erstellen = el('button', {
      type: 'button',
      onClick: async () => {
        erstellen.disabled = true;
        ersetzeKinder(bereit);
        try {
          const blob = await baueExportBlob(speicher, new Date(), { mitFotos: true, fortschritt: (i, n) => { fortschritt.textContent = `Bild ${i} von ${n} wird eingepackt …`; } });
          const dateiMit = new File([blob], dateinameMitFotos, { type: 'application/json' });
          fortschritt.textContent = `Die Datei ist fertig (${bytesText(dateiMit.size)}).`;
          ersetzeKinder(bereit, el('button', { type: 'button', class: 'primaer', onClick: () => sichere(dateiMit, dateinameMitFotos) }, `„${dateinameMitFotos}“ sichern (${bytesText(dateiMit.size)})`));
        } catch (fehler) {
          fortschritt.className = 'meldung fehler';
          fortschritt.textContent = `Die Datei lässt sich nicht erstellen: ${fehler.message}`;
        } finally {
          erstellen.disabled = false;
        }
      },
    }, 'Sicherung mit Fotos erstellen');
    return el(
      'div', { class: 'fotoexport' },
      el('p', { class: 'zeile' }, `Fotos und Baupläne: ${fotoStand.fotos} Foto(s), ${fotoStand.hintergruende} Bauplan/Baupläne, ${bytesText(fotoStand.bytes)} im Speicher.`),
      el('p', { class: 'zeile' }, `Größe der Sicherungsdatei: ohne Fotos etwa ${bytesText(groesse.ohne)}, mit Fotos etwa ${bytesText(groesse.mit)}.`),
      el('div', { class: 'knopfzeile' }, erstellen),
      fortschritt,
      bereit,
    );
  }

  const dateiwahl = el('input', {
    type: 'file', class: 'versteckt', 'aria-label': 'Sicherungsdatei wählen',
    onChange: async () => {
      const gewaehlt = dateiwahl.files[0];
      if (!gewaehlt) return;
      zeigeVorschau(pruefeImport(await gewaehlt.text()), gewaehlt.name);
      dateiwahl.value = '';
    },
  });

  ersetzeKinder(
    container,
    el('div', { class: 'kopf' }, el('h2', {}, 'Sicherung')),
    el(
      'p', { class: 'beschreibung' },
      'Alle Daten liegen nur auf diesem Gerät. Die Sicherungsdatei enthält das ganze Projekt. Sie lässt sich in der Dateien-App '
      + 'oder in iCloud Drive aufbewahren und später wieder einlesen.',
    ),
    statusZeile,
    el(
      'section', { class: 'karte abstand', 'data-lesen': true },
      el('h3', {}, 'Sicherung exportieren'),
      el('p', { class: 'zeile' }, `Jetzt in der App: ${aktuell.raeume} Räume, ${aktuell.raumflaechen} Raumflächen, ${aktuell.heizkoerper} Heizkörper, ${aktuell.verbrauch} Verbrauchsabgleiche.`),
      fotoExportBlock(),
      el('div', { class: 'knopfzeile' }, el('button', { type: 'button', class: 'primaer', onClick: () => sichere() }, 'Sicherungsdatei exportieren (ohne Fotos)')),
      exportRueckmeldung,
      el('p', { class: 'hinweis' }, `Dateiname: ${dateiname}. Auf dem iPad öffnet sich das Teilen-Menü: „In Dateien sichern“ wählen.`),
    ),
    el(
      'section', { class: 'karte abstand' },
      el('h3', {}, 'Sicherung importieren'),
      el('p', { class: 'zeile' }, 'Wähle eine Sicherungsdatei. Vor dem Ersetzen siehst du, was in der Datei steht, und musst es bestätigen.'),
      el('div', { class: 'knopfzeile' }, el('label', { class: 'knopf' }, 'Sicherungsdatei wählen …', dateiwahl)),
    ),
    vorschau,
    el(
      'section', { class: 'abstand' },
      el('h3', {}, 'Beispieldatei'),
      el(
        'p', { class: 'zeile' },
        'Ein erfundenes Mini-Haus mit drei Räumen zeigt das Format. ',
        el('a', { href: 'examples/beispiel-mini-haus.json', download: 'beispiel-mini-haus.json' }, 'Beispieldatei laden'),
        ' · ',
        el('a', { href: 'examples/format-beschreibung.md' }, 'Formatbeschreibung'),
      ),
    ),
  );
}
