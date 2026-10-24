# Heizlast

Eine Web-App für die raumweise Heizlastberechnung eines bestehenden Hauses, gedacht für iPad und iPhone (Safari).
Sie arbeitet nach der Struktur der DIN EN 12831-1 in einer vereinfachten Form, rechnet jede Größe als Bandbreite
(günstig bis ungünstig) und läuft komplett im Browser: ohne Server, ohne Konto, ohne Cloud.

**Wichtig:** Die App ist eine eigene Prüfung und Auslegungshilfe. Sie ersetzt keine offizielle Heizlastberechnung,
zum Beispiel für Förderanträge. Das steht auch in jedem Bericht.

## Was die App kann

- **Räume und Flächen:** Maße oder Flächen, Bauteile mit U-Wert (Bereich von bis), Fenster und Türen, Zonen
  (Erdreich, Nachbar, unbeheizter Keller und so weiter), Luftwechsel je Raum.
- **Heizlast je Raum und für das Gebäude** bei der Normaußentemperatur, als Bandbreite, mit Gegenprobe der
  Gebäudesumme gegen die Raumsummen.
- **Passive Räume** (zum Beispiel ein Flur ohne Heizkörper): ihr Verlust wird prozentual auf die liefernden Räume verteilt.
- **Heizkörper und Vorlauftemperatur:** Leistung nach Norm-Bedingungen, Wärmepumpen-Kennlinien, nötige Vorlauftemperatur
  je Haus und je Raum, bestimmender Raum.
- **Verbrauchsabgleich:** Gasverbrauch und Holz in eine Heizlast umgerechnet, mit zwei Innentemperaturen
  (tatsächlich und gewünscht) und Vergleich zur Rechnung.
- **Bericht:** druckoptimierte Auswertung (A4), als PDF sicherbar.
- **Sicherung:** Export und Import als JSON-Datei.
- **Offline:** nach dem ersten Öffnen läuft die App ohne Internet.

## 1. App im Netz bereitstellen (GitHub Pages)

Die Dateien dieses Repositorys sind die fertige App. Es gibt keinen Build-Schritt. GitHub kann sie direkt ausliefern:

1. Öffne das Repository auf github.com und tippe auf **Settings** (Einstellungen).
2. Links auf **Pages**.
3. Bei **Source** (Quelle) **Deploy from a branch** wählen.
4. Bei **Branch** `main` und den Ordner `/ (root)` wählen, dann **Save**.
5. Nach ein bis zwei Minuten steht dort die Adresse, für dieses Repository
   `https://xanadumobil-beep.github.io/Heizlast/`.

Nach jedem Push auf `main` aktualisiert GitHub die Seite von selbst (ebenfalls ein bis zwei Minuten).

## 2. Auf dem iPad oder iPhone installieren

1. Öffne die Adresse in **Safari** (nicht in einem anderen Browser, nicht in der Vorschau einer Chat-App).
2. Tippe auf das **Teilen-Symbol** (Quadrat mit Pfeil nach oben).
3. Wähle **Zum Home-Bildschirm**, dann **Hinzufügen**.
4. Starte die App künftig über das Symbol auf dem Home-Bildschirm. Sie öffnet sich ohne Safari-Leiste.

### Offline

Beim ersten Öffnen mit Internet lädt die App alle ihre Dateien in den Speicher des Geräts. Danach läuft sie auch im
Flugmodus, zum Beispiel im Keller. Öffne sie nach der Installation einmal mit Internet vollständig, bevor du dich
auf Offline verlässt.

### Neue Versionen

Wenn es eine neue Version gibt, lädt die App sie im Hintergrund und zeigt oben **„Eine neue Version der App ist bereit“**
mit dem Knopf **„Jetzt neu laden“**. Deine Daten bleiben dabei erhalten.

## 3. Datensicherung (bitte ernst nehmen)

Alle Eingaben liegen **nur auf dem Gerät**, in der Datenbank des Browsers (IndexedDB). Es gibt keine Kopie im Netz.
Das hat zwei Folgen:

- **Safari-Tab und Home-Bildschirm-App haben getrennte Datenbestände.** Was du im Safari-Tab eingibst, siehst du in
  der App vom Home-Bildschirm nicht und umgekehrt. Entscheide dich für einen Weg. Empfehlung: die Home-Bildschirm-App.
  Wechselst du, sichere vorher im alten Weg und importiere im neuen.
- **Safari kann lokale Daten löschen**, wenn eine Seite länger nicht benutzt wurde, oder wenn du Website-Daten
  löschst. Das Löschen der Safari-Verlaufsdaten kann die Daten ebenfalls entfernen.

Deshalb gibt es die Sicherungsdatei:

1. Tab **Sicherung** öffnen, **„Sicherungsdatei exportieren“** tippen.
2. Im Teilen-Menü **„In Dateien sichern“** wählen, am besten in iCloud Drive.
3. Die App erinnert dich mit einem Banner, wenn die letzte Sicherung länger als 14 Tage zurückliegt.

**Wiederherstellen:** Tab Sicherung, **„Sicherungsdatei wählen …“**, Datei auswählen, Vorschau prüfen,
**„Daten ersetzen“**. Der Import ersetzt alle Daten in der App und wird entweder vollständig oder gar nicht ausgeführt.

Tipp: Lädt Safari eine Datei als `….json.txt` herunter, lässt sie sich trotzdem importieren.

In den **Einstellungen** zeigt die App, ob der Browser dauerhaften Speicher gewährt hat. Auch dann gilt: Die
Sicherungsdatei ist die einzige echte Absicherung.

## 4. Bericht als PDF

Tab **Bericht**, **„Drucken / als PDF sichern“**. Im iPad-Druckdialog mit zwei Fingern auf die Vorschau aufziehen,
dann **Teilen → In Dateien sichern**. Kopf- und Fußzeile sowie den Dateinamen setzt iOS selbst.

## 5. Datenschutz und Repository

Das Repository ist öffentlich. **Hier dürfen keine echten Hausdaten liegen.** Die App enthält keine Daten, nur Code.
Echte Sicherungsdateien (`heizlast-sicherung-*.json`) sind über `.gitignore` ausgeschlossen. Die Beispieldatei
`examples/beispiel-mini-haus.json` beschreibt ein erfundenes Haus. Ihr Format steht in
`examples/format-beschreibung.md`.

Die App sendet keine Daten ins Netz und benutzt keine externen Dienste, Schriften oder Skripte.

## 6. Für Entwickler

Kein Build-Schritt, nur ES-Module. Lokal ausprobieren:

```
python3 -m http.server 8000     # dann http://localhost:8000
```

**Tests** (Rechenkern, Validierung, Import/Export, Bericht, Offline-Dateiliste):

```
npm test                         # in Node
```

oder im Browser `tests/tests.html` öffnen.

**Service Worker:** `sw.js` enthält die Liste aller App-Dateien und eine Version, die aus dem Dateiinhalt berechnet wird.
Nach jeder Änderung an App-Dateien (`js/`, `css/`, `icons/`, `examples/`, `index.html`, `manifest.webmanifest`):

```
npm run sw
```

Der Test „Offline: sw.js enthält alle App-Dateien und die aktuelle Version“ schlägt fehl, wenn das vergessen wurde.
Ohne neue Version würden Geräte weiter die alten Dateien aus dem Speicher liefern.

Aufbau:

```
index.html, manifest.webmanifest, sw.js, icons/
css/              style.css, print.css (A4-Druck)
js/engine/        Rechenkern (reine Funktionen, ohne Browser): Heizlast, Heizkörper, Vorlauf, Verbrauch, Format
js/               Datenmodell, Validierung, IndexedDB, Import/Export, Bericht
js/views/         Ansichten (Räume, Vorlauf, Verbrauch, Bericht, Kataloge, Sicherung, Einstellungen)
tests/            Tests mit eigenem kleinen Runner
tools/            Hilfsskripte für den Service Worker
examples/         erfundenes Beispielhaus und Formatbeschreibung
```

Geplant für spätere Stufen (im Datenmodell und im Sicherungsformat bereits vorgesehen): Fotos je Raum mit
Markierungen, Szenarien mit geänderten U-Werten und Heizkörper-Status.
