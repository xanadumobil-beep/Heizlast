# Format der Katalogdatei (Wärmepumpen)

Die Katalogdatei enthält nur Wärmepumpen und keine Hausdaten. Sie lässt sich in der App unter **Grundlagen → Wärmepumpen** mit „Katalogdatei importieren …“ einlesen
und mit „Katalog als Datei exportieren“ schreiben. Dieselbe Liste steckt auch in der normalen Sicherungsdatei (Schlüssel `daten.waermepumpen`, ab Version 4).
Die Datei ist JSON, UTF-8, Zahlen mit Punkt als Dezimaltrennzeichen. Ein erfundenes Beispiel steht in `examples/beispiel-waermepumpen.json`.

## Aufbau

```
{
  "format": "heizlast-waermepumpenkatalog",
  "schemaVersion": 4,
  "exportiertAm": "2026-10-24T08:00:00.000Z",
  "app": "Heizlast",
  "daten": { "waermepumpen": [ { …Gerät… }, { …Gerät… } ] }
}
```

| Feld | Typ | Pflicht | Bedeutung |
|---|---|---|---|
| `format` | Text | ja | Genau `heizlast-waermepumpenkatalog`. Mit `heizlast-projekt` (Sicherung) lehnt die Katalog-Import die Datei ab. |
| `schemaVersion` | ganze Zahl | ja | `4`. Höhere Versionen als die der App werden abgelehnt, niedrigere als 4 gibt es für Katalogdateien nicht. |
| `exportiertAm` | Text (ISO-Zeit) | nein | Zeitpunkt der Erstellung, nur zur Anzeige. |
| `app` | Text | nein | Nur Information. |
| `daten.waermepumpen` | Liste | ja | Die Geräte. Eine leere Liste ist erlaubt. |

## Gerät

Jedes Gerät ist ein Objekt. Fehlende optionale Felder ergänzt die App mit leeren Werten. Unbekannte Felder bleiben erhalten, werden aber nicht ausgewertet.

| Feld | Typ, Einheit | Pflicht | Erlaubte Werte, Bedeutung |
|---|---|---|---|
| `id` | Text | **ja** | Eindeutige, nicht leere Kennung innerhalb der Datei, zum Beispiel `wp-hersteller-modell-9`. Fehlt sie oder kommt sie doppelt vor, wird die ganze Datei abgelehnt. Beim Import „hinzufügen“ überschreibt eine gleiche Kennung das vorhandene Gerät. |
| `hersteller` | Text | nein | Freitext. Erscheint zusammen mit `modell` als Name des Geräts. |
| `modell` | Text | empfohlen | Freitext. Ohne Modell markiert die App das Gerät mit „prüfen“. |
| `typ` | Text | nein | Genaue Typbezeichnung wie im Angebot oder Datenblatt. |
| `anbieter` | Text | nein | Anbieter oder Angebot. |
| `preis` | Objekt oder `null` | nein | `{ "min": <€>, "max": <€> }`, beide Zahlen ≥ 0, `min` ≤ `max`. `null`, wenn nicht bekannt. |
| `datenblatt` | Text | nein | Link zum Datenblatt. Als Link angezeigt, wenn er mit `http://` oder `https://` beginnt, sonst als Text. Die App ruft nichts ab. |
| `notiz` | Text | nein | Freitext. |
| `schall` | Zahl in dB(A) oder `null` | nein | Schallleistungspegel des Außengeräts, Wertebereich 30 bis 90 (außerhalb eine Warnung). Nur für den Vergleich der Geräte untereinander. |
| `bafa` | Objekt | nein | Siehe unten. |
| `punkte` | Liste | für die Prüfung ja | Leistungspunkte aus dem Datenblatt, siehe unten. Leer erlaubt: Das Gerät wird dann nur vorausgewählt (Stufe A). |

### `bafa`

| Feld | Typ, Einheit | Pflicht | Erlaubte Werte, Bedeutung |
|---|---|---|---|
| `foerderfaehig` | Text | nein | `"ja"`, `"nein"` oder `"unbekannt"` (Standard). Andere Werte gelten als unbekannt, mit Hinweis. |
| `nennleistung55` | Zahl in kW oder `null` | für die Vorauswahl ja | BAFA-Nennleistung bei 55 °C Vorlauf, größer als 0. **Kein Auslegungswert:** Sie bezieht sich auf eine Auslegung bei −10 °C (EU-Durchschnittsklima). Nur für die grobe Vorauswahl (Stufe A) ohne Datenblattpunkte. |
| `eta35` | Zahl in % oder `null` | für Effizienz ja | Raumheizungs-Jahresnutzungsgrad ETAs bei 35 °C, als Prozentwert, zum Beispiel `190` (nicht `1.9`). Üblich 100 bis 300. |
| `eta55` | Zahl in % oder `null` | für Effizienz ja | ETAs bei 55 °C, ebenso. Die App interpoliert linear zwischen 35 und 55 °C. |
| `kaeltemittel` | Text | nein | Zum Beispiel `"R290"`. |
| `stand` | Text, Datum | nein | `"JJJJ-MM-TT"`, zum Beispiel `"2026-01-15"`, oder leer `""`. Andere Schreibweisen führen zu einem Hinweis. |

### `punkte`

Beliebig viele Einträge, Reihenfolge egal. Jeder Eintrag ist ein Messpunkt aus dem Datenblatt:

| Feld | Typ, Einheit | Pflicht | Bedeutung |
|---|---|---|---|
| `aussen` | Zahl in °C | ja | Außentemperatur (A), zum Beispiel `-7`, `2`, `7`. |
| `vorlauf` | Zahl in °C | ja | Vorlauftemperatur (W), größer als 0, zum Beispiel `35`, `55`. |
| `max` | Zahl in kW | `max` oder `min` | Maximale Heizleistung bei diesem Punkt, größer als 0. |
| `min` | Zahl in kW oder `null` | `max` oder `min` | Minimale Heizleistung (kleinste Modulationsstufe), größer als 0, nicht größer als `max`. |
| `cop` | Zahl oder `null` | nein | COP bei diesem Punkt, wird derzeit nur gespeichert. |

Jeder Punkt braucht `aussen`, `vorlauf` und mindestens `max` oder `min`. Nicht benötigte Werte als `null` schreiben oder weglassen.

**Pflicht für die Prüfung (Stufe B):**
1. `max` bei `aussen: -7` mit `vorlauf: 35`,
2. `max` bei `aussen: -7` mit `vorlauf: 55`,
3. ein Punkt mit `min` bei `aussen` 7 oder höher.

Fehlt etwas davon, zeigt die App „nicht prüfbar: …“ und nennt das Fehlende. Je mehr Punkte, desto besser lässt sich zwischen den Punkten rechnen: Die App interpoliert linear über die
Vorlauftemperatur und dann über die Außentemperatur und setzt höchstens 3 K über die äußersten Punkte hinaus fort. Empfehlung: A−7, A2, A7 jeweils mit W35 und W55 (maximal), dazu A7 mit minimaler Leistung.

## Was die App mit den Werten macht

| Kriterium | Verwendete Felder |
|---|---|
| Vorauswahl (Stufe A, nur ohne Datenblattpunkte) | `bafa.nennleistung55` |
| Deckung bei Normaußentemperatur | `punkte[].max` (mit `aussen`, `vorlauf`) |
| Bivalenzpunkt | `punkte[].max` |
| Taktprüfung | `punkte[].min` (mit `aussen`, `vorlauf`), sonst nächstliegender Punkt |
| Effizienz | `bafa.eta35`, `bafa.eta55` |
| Schall | `schall` |

## Was beim Import passiert

- **Abgelehnt** (nichts wird verändert): kein gültiges JSON, falsches `format`, fehlende oder zu hohe `schemaVersion`, `daten.waermepumpen` keine Liste, ein Eintrag kein Objekt, `id` fehlt oder doppelt.
- **Hinweise** (Import geht trotzdem): unlesbare oder unplausible Zahlen, Zahlen als Text (zum Beispiel `"9,0"`: werden nicht gelesen, als JSON-Zahl `9.0` schreiben), fehlende Pflichtpunkte, Datum im falschen Format, unbekannter `foerderfaehig`-Wert.
- Danach wählst du „Zum Katalog hinzufügen“ (gleiche `id` überschreibt, übrige Geräte bleiben) oder „Katalog ersetzen“ (der bisherige Katalog wird ersetzt). Hausdaten bleiben in beiden Fällen unberührt.

## Beispiel

```json
{
  "format": "heizlast-waermepumpenkatalog",
  "schemaVersion": 4,
  "exportiertAm": "2026-10-24T08:00:00.000Z",
  "app": "Heizlast",
  "daten": {
    "waermepumpen": [
      {
        "id": "wp-beispiel-alpha",
        "hersteller": "Beispiel-Hersteller",
        "modell": "Alpha 9",
        "typ": "Alpha 9 Monoblock, 1-phasig",
        "anbieter": "Beispiel-Angebot (erfunden)",
        "preis": { "min": 9500, "max": 11000 },
        "datenblatt": "https://example.invalid/alpha-9-datenblatt.pdf",
        "notiz": "Erfundenes Gerät, die Werte stammen nicht aus einem echten Datenblatt.",
        "bafa": { "foerderfaehig": "ja", "nennleistung55": 8.6, "eta35": 190, "eta55": 150, "kaeltemittel": "R290", "stand": "2026-01-15" },
        "punkte": [
          { "aussen": -7, "vorlauf": 35, "max": 9.0, "min": null, "cop": 2.9 },
          { "aussen": -7, "vorlauf": 55, "max": 7.0, "min": null, "cop": 2.0 },
          { "aussen": 2, "vorlauf": 35, "max": 10.5, "min": null, "cop": 3.9 },
          { "aussen": 2, "vorlauf": 55, "max": 8.5, "min": null, "cop": 2.7 },
          { "aussen": 7, "vorlauf": 35, "max": 11.0, "min": 3.0, "cop": 5.0 },
          { "aussen": 7, "vorlauf": 55, "max": 9.5, "min": 3.2, "cop": 3.3 }
        ],
        "schall": 54
      },
      {
        "id": "wp-beispiel-beta",
        "hersteller": "Beispiel-Hersteller",
        "modell": "Beta 6",
        "typ": "",
        "anbieter": "",
        "preis": null,
        "datenblatt": "",
        "notiz": "Nur BAFA-Werte bekannt: Vorauswahl, noch keine Datenblattpunkte.",
        "bafa": { "foerderfaehig": "unbekannt", "nennleistung55": 6.2, "eta35": 185, "eta55": 145, "kaeltemittel": "R290", "stand": "" },
        "punkte": [],
        "schall": 49
      }
    ]
  }
}
```

## Checkliste für eine extern erstellte Datei

1. `format` und `schemaVersion` exakt wie oben, `daten.waermepumpen` als Liste.
2. Jedes Gerät mit eindeutiger `id`, am besten sprechend und stabil (so lässt sich ein Gerät später gezielt überschreiben).
3. Alle Zahlen als JSON-Zahlen mit Punkt, Leistungen in kW (nicht W), Temperaturen in °C, ETAs in Prozent.
4. Für die Prüfung: A−7/W35 und A−7/W55 mit `max` sowie ein Punkt mit `min` bei A7 oder höher. Weitere Punkte (A2, A7, W45 …) verbessern die Interpolation.
5. Nur Werte eintragen, die im Datenblatt stehen. Was fehlt, bleibt `null` oder fehlt ganz, die App rät nichts.
6. Gerät ohne Datenblattpunkte: `punkte` leer lassen und `bafa.nennleistung55` setzen, dann gibt es die grobe Vorauswahl.
