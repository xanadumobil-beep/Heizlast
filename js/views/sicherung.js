// Sicherung: Export als JSON-Datei (Teilen-Menü, Dateien-App) und Import mit Warnung vor dem Überschreiben.

import * as db from '../db.js';
import { el, ersetzeKinder } from '../ui.js';
import { aktualisiereBanner } from '../banner.js';
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
  const aktuell = zusammenfassung(speicher);
  const jetzt = new Date();
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

  async function sichere() {
    const ergebnis = await gibDateiAus(datei);
    if (ergebnis === 'abgebrochen') {
      exportRueckmeldung.textContent = '';
      return false;
    }
    const neu = { zeit: new Date().toISOString(), art: 'export', dateiname };
    await db.speichereSicherung(neu);
    zeigeStatus(neu);
    exportRueckmeldung.textContent = ergebnis === 'geteilt'
      ? 'Sicherung übergeben. Im Teilen-Menü „In Dateien sichern“ wählen und einen Ordner in iCloud Drive aussuchen.'
      : `Die Datei „${dateiname}“ wurde heruntergeladen. Sie liegt im Download-Ordner des Browsers.`;
    aktualisiereBanner();
    return true;
  }

  async function ersetze(pruefung, name) {
    const jetztDaten = zusammenfassung(speicher);
    const neu = pruefung.zusammenfassung;
    const frage = `Alle aktuellen Daten ersetzen?\n\nJetzt in der App: ${jetztDaten.raeume} Räume, ${jetztDaten.raumflaechen} Raumflächen, ${jetztDaten.heizkoerper} Heizkörper.\n`
      + `Aus der Datei: ${neu.raeume} Räume, ${neu.raumflaechen} Raumflächen, ${neu.heizkoerper} Heizkörper.\n\n`
      + 'Das lässt sich nicht rückgängig machen.';
    if (!confirm(frage)) return;
    const eintrag = { zeit: pruefung.exportiertAm ?? new Date().toISOString(), art: 'import', dateiname: name };
    try {
      await db.ersetzeAlles(pruefung.daten, eintrag);
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
        begrenzteListe('Verweise ohne Ziel', pruefung.verweise),
        begrenzteListe(
          'Einträge mit Hinweisen (werden importiert und markiert)',
          pruefung.inhalt.map((m) => `${m.bereich} „${m.name}“: ${m.text}`),
        ),
        el(
          'div', { class: 'knopfzeile' },
          el('button', { type: 'button', onClick: sichere }, 'Aktuelle Daten zuerst sichern'),
          el('button', { type: 'button', class: 'gefahr', onClick: () => ersetze(pruefung, name) }, 'Daten ersetzen'),
          el('button', { type: 'button', onClick: () => ersetzeKinder(vorschau) }, 'Abbrechen'),
        ),
      ),
    );
  }

  const dateiwahl = el('input', {
    type: 'file', accept: '.json,application/json', class: 'versteckt', 'aria-label': 'Sicherungsdatei wählen',
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
      'section', { class: 'karte abstand' },
      el('h3', {}, 'Sicherung exportieren'),
      el('p', { class: 'zeile' }, `Jetzt in der App: ${aktuell.raeume} Räume, ${aktuell.raumflaechen} Raumflächen, ${aktuell.heizkoerper} Heizkörper, ${aktuell.verbrauch} Verbrauchsabgleiche.`),
      el('div', { class: 'knopfzeile' }, el('button', { type: 'button', class: 'primaer', onClick: sichere }, 'Sicherungsdatei exportieren')),
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
