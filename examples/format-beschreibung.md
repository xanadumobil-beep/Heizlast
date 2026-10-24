# Format der Sicherungsdatei

Die App sichert und lädt Projektdaten als **JSON-Datei**. Diese Beschreibung gehört zu
`beispiel-mini-haus.json`, einem **erfundenen** Haus mit drei Räumen. Wer eine bestehende Tabelle in dieses
Format umwandeln lässt, bekommt hier alle Felder, erlaubten Werte und Regeln.

Die Beispieldatei enthält keine echten Daten. Echte Sicherungen heißen `heizlast-sicherung-JJJJ-MM-TT.json` und
sind über `.gitignore` vom Hochladen ins Repository ausgeschlossen, weil das Repository öffentlich ist.

## Grundregeln

- Dezimalzahlen mit **Punkt** (`0.15`), nicht mit Komma. Die App zeigt später Kommas an.
- Einheiten: Leistung in **W**, Temperatur in **°C**, Längen in **m**, Flächen in **m²**, Volumen in **m³**,
  Maße von Heizkörpern in **mm**, Energie in **kWh**, U-Werte in **W/(m²K)**.
- Unbekannte Werte sind **`null`**. Die App erfindet nichts. Fehlt bei einem Heizkörper die Leistung, gilt er als
  „Leistung fehlt“ und bekommt keine Vorlauftemperatur.
- Jeder Eintrag hat eine **`id`** (Text, in der Datei eindeutig, zum Beispiel `raum-wohnen`). Die IDs dürfen frei gewählt
  werden, müssen aber **dauerhaft** bleiben: Verweise zwischen den Einträgen laufen über sie, und die Fotomarkierungen
  der späteren Stufe 2 verweisen auf die IDs von **Öffnungen** und **Heizkörpern**. Beim Export und Import bleiben
  alle IDs unverändert.
- Beim Import prüft die App: gültiges JSON, Kennung, Formatversion, IDs vorhanden und eindeutig. Fehlende Verweise
  (zum Beispiel ein Bauteil, das es nicht gibt) und unplausible Werte führen nicht zum Abbruch. Sie erscheinen als
  Hinweise, und die betroffenen Einträge sind in der App markiert.

## Kopf

| Feld | Bedeutung |
|---|---|
| `format` | immer `"heizlast-projekt"` |
| `schemaVersion` | derzeit `1` |
| `exportiertAm` | Zeitpunkt des Exports (ISO-Format) |
| `app` | `"Heizlast"` |
| `daten` | alle Projektdaten, siehe unten |

## `daten.einstellungen` (ein Objekt)

| Feld | Bedeutung |
|---|---|
| `id` | immer `"projekt"` |
| `projektname` | frei, erscheint im Bericht |
| `thetaAussen` | Normaußentemperatur in °C (zum Beispiel `-8`) |
| `luftwechselStandard` | `{ "min": 0.5, "max": 1 }` Luftwechsel in 1/h für Räume ohne eigenen Wert |
| `dUWB` | `{ "min": 0.05, "max": 0.15 }` Wärmebrückenzuschlag, nur für Bauteile der Gebäudehülle |
| `fg` | Korrekturfaktor für Verluste ins Erdreich |
| `aufheizzuschlag` | `{ "aktiv": false, "wProM2": 0 }` |
| `spreizung` | Spreizung Vor-/Rücklauf in K |
| `heizkoerperExponent` | Standard-Exponent n |
| `zielVorlauf` | zuletzt gewählte Ziel-Vorlauftemperatur in °C |

## `daten.zonen`

Angrenzende Bereiche mit Temperatur. **Außenluft ist keine Zone**, sie folgt `thetaAussen`.
Passiv mitbeheizte Räume sind keine Zonen, sondern Räume mit Status `passiv`.

`id`, `name`, `art` (`erdreich`, `unbeheizt`, `nachbar`), `temperatur` (`{ "min", "max" }` in °C), `notiz`.

## `daten.bauteile`

`id`, `name`, `art` (`aussenwand`, `dach`, `kellerdecke`, `bodenplatte`, `erdberuehrteWand`, `nachbarwand`, `innenwand`,
`innendecke`), `u` (`{ "min", "max" }`, bei sicherem Wert beide gleich), `aufbau` (Notiz),
`quelle` (`rechnung`, `stempel`, `schaetzung`).

## `daten.oeffnungstypen`

`id`, `name`, `art` (`fenster`, `tuer`), `uw` (eine Zahl), `quelle` (wie bei den Bauteilen).

## `daten.raeume`

| Feld | Bedeutung |
|---|---|
| `id`, `name` | Kennung und Name |
| `geschoss` | `EG` oder `Keller` |
| `status` | `beheizt`, `passiv` (mitbeheizt, ohne eigenen Heizkörper) oder `unbeheizt` (wird nicht gerechnet, die Wirkung läuft über eine Zone) |
| `theta` | Soll-Temperatur in °C, bei `passiv` die angenommene Temperatur |
| `flaeche`, `hoehe` | Raumfläche in m², lichte Höhe in m |
| `volumenManuell` | `null` (dann Fläche × Höhe) oder ein Volumen in m³ |
| `luftwechsel` | `null` (Standard gilt) oder `{ "min", "max" }` in 1/h |
| `waermeLieferanten` | nur bei `passiv`: `[ { "raumId": "...", "prozent": 60 }, ... ]`. Die Summe muss **100** ergeben. So wird der Netto-Verlust des passiven Raums den liefernden beheizten Räumen zugerechnet. |
| `plan` | optional: `null` oder `{ "x": 0 bis 100, "y": 0 bis 100 }`, Position des Raums im Plan. **Mittelpunkt des Kastens in Prozent der Breite und Höhe der Zeichenfläche seines Geschosses**, Ursprung links oben. Fehlt der Wert oder ist er ungültig, ordnet die App den Raum automatisch an. Die Prozentangabe gilt später auch relativ zu einem Hintergrundbild (fotografierter Bauplan) des Geschosses. |
| `notiz` | freier Text |

## `daten.raumflaechen`

Jede Fläche gehört zu genau einem Raum. **Öffnungen stecken in der Fläche** und werden von deren Fläche abgezogen.

| Feld | Bedeutung |
|---|---|
| `id`, `raumId`, `name` | Kennung, Raum, optionale Bezeichnung |
| `bauteilId` | Verweis auf `bauteile` |
| `angrenzend` | `{ "art": "aussen" }`, `{ "art": "zone", "zoneId": "..." }` oder `{ "art": "raum", "raumId": "..." }` |
| `modus` | `laengeHoehe` (dann `laenge` und `hoehe`) oder `flaeche` (dann `flaeche`). Die nicht genutzten Felder sind `null`. |
| `oeffnungen` | Liste mit `id`, `typId` (Verweis auf `oeffnungstypen`), `name`, `modus`, `laenge` (Breite), `hoehe`, `flaeche` (je Stück), `anzahl` |
| `notiz` | freier Text |

**Wände zwischen zwei Räumen:** Ein Raum verliert Wärme an einen **kälteren beheizten** Nachbarraum
(A · U · ΔT, ohne Wärmebrückenzuschlag). Das zählt in der Raumheizlast des wärmeren Raums, nicht in der
Gebäudesumme. Eine Gutschrift aus einem wärmeren Nachbarn gibt es nicht. Verluste an einen **passiven** Raum zählen
nicht, weil seine Wärme über `waermeLieferanten` zugerechnet wird. Die Wand sollte in **beiden** Räumen stehen. Es
zählt der Eintrag im wärmeren Raum.

## `daten.heizkoerper`

| Feld | Bedeutung |
|---|---|
| `id`, `raumId` | Kennung und Raum (nur beheizte Räume) |
| `bauart` | `platten`, `glieder`, `handtuch`, `wp` (Wärmepumpen-Heizkörper mit Lüfter), `sonstige` |
| `typ` | bei Plattenheizkörpern `""`, `11`, `21`, `22`, `33` oder `andere` |
| `status` | `bleibt`, `entfaellt`, `neu`, `geplant`. „entfällt“ zählt bei der Deckung nicht mit. |
| `material` | `""`, `stahl`, `guss`, `aluminium`, `sonstiges` |
| `ventil` | `neu` oder `alt` (alt ist nur ein Hinweis, die Leistung ändert sich nicht) |
| `bauhoehe`, `baulaenge`, `bautiefe`, `nabenabstand` | in mm, oder `null` |
| `gliederzahl`, `leistungJeGlied` | nur Gliederheizkörper |
| `normleistung` | Leistung in W bei den Normbedingungen, oder `null` |
| `normVorlauf`, `normRuecklauf`, `normRaum` | **Pflicht außer bei `wp`, ohne Standardwert**: die Bedingungen, auf die sich `normleistung` oder `leistungJeGlied` beziehen (zum Beispiel 55/45/20). Ein falscher Wert verfälscht die Leistung stark. |
| `exponent` | `null` (Standard aus den Einstellungen) oder ein eigener Exponent n |
| `kennlinie` | nur `wp`: Wertepaare `[ { "vorlauf": 35, "leistung": 600 }, ... ]`, mindestens zwei, linear interpoliert, nicht extrapoliert |
| `kennlinieRaumtemperatur` | Raumtemperatur, für die die Kennlinie gilt |
| `notiz` | freier Text |

Die Leistung ist bei Gliederheizkörpern `normleistung`, wenn gesetzt, sonst `gliederzahl × leistungJeGlied`.

## `daten.verbrauch`

Je Eintrag ein Abgleich einer Heizperiode.

| Feld | Bedeutung |
|---|---|
| `id`, `name` | Kennung und Bezeichnung |
| `gasKwh` | Gasverbrauch in kWh (bezogen auf Brennwert Hs, wie in der Gasrechnung) |
| `nichtFuerHeizungKwh` | davon nicht für Heizung: Warmwasser, Gasherd, Sonstiges |
| `kesselNutzungsgrad` | `{ "min", "max" }` in %, bezogen auf Brennwert Hs |
| `holzRm` | Raummeter Holz oder `null` |
| `heizwertRm`, `ofenWirkungsgrad` | `{ "min", "max" }` in kWh/Rm beziehungsweise %, nur mit Holz nötig, sonst `null` |
| `innentemperaturIst` | `{ "min", "max" }` tatsächliche mittlere Innentemperatur im Verbrauchszeitraum, geschätzt. Geht in die Gradtag-Umrechnung ein. |
| `innentemperaturSoll` | mittlere Soll-Innentemperatur für die Auslegung. Geht nur in die Hochrechnung auf die Normaußentemperatur ein. |
| `monate` | je Monat `id`, `name`, `gradtage` (G20/15 in Kd), `heiztage`, `heizmonat` (`true`, wenn geheizt wurde; nur diese Monate zählen) |
| `notiz` | freier Text |

## Pflicht oder optional, und wie Verweise aufgebaut sind

**Allgemein:** Alle Felder immer angeben, nicht Verwendetes mit `null` (oder `[]` bei Listen). Die Schlüssel sind
**deutsch** (`einstellungen`, `zonen`, `bauteile`, `oeffnungstypen`, `raeume`, `raumflaechen`, `heizkoerper`, `verbrauch`),
nicht die englischen Namen der internen Datenbank.

**Harte Fehler (Import wird abgelehnt):** kein gültiges JSON, `format` ist nicht `"heizlast-projekt"`, `schemaVersion` fehlt
oder ist größer als 1, `daten` fehlt, eine Liste ist keine Liste, ein Eintrag hat keine oder eine leere `id`, eine `id`
kommt innerhalb ihrer Liste doppelt vor, Öffnungs-IDs oder Heizkörper-IDs kommen doppelt vor.
Alles andere (unbekannte Verweise, unplausible Werte, fehlende Leistung) führt nicht zum Abbruch, sondern zu Hinweisen
und Markierungen in der App.

**IDs:** Text, nicht leer, innerhalb einer Liste eindeutig, dauerhaft. Eindeutig sein müssen insbesondere die IDs aller
Öffnungen (sie stecken in den Raumflächen) und aller Heizkörper über die gesamte Datei. Die Monate im Verbrauchsabgleich
bekommen ebenfalls eine `id` je Monat. Öffnungen ohne `id` bekommt die App eine zufällige, aber dann nicht von dir
vorhersehbare ID. Besser immer selbst vergeben.

**Verweise** (Ziel muss als `id` in der Datei vorkommen):

| Von | Feld | Ziel |
|---|---|---|
| Raumfläche | `raumId` | `raeume[].id` (der Raum, zu dem die Fläche gehört) |
| Raumfläche | `bauteilId` | `bauteile[].id` |
| Raumfläche | `angrenzend.zoneId` (bei `art: "zone"`) | `zonen[].id` |
| Raumfläche | `angrenzend.raumId` (bei `art: "raum"`) | `raeume[].id` (Gegenseite) |
| Öffnung | `typId` | `oeffnungstypen[].id` |
| Heizkörper | `raumId` | `raeume[].id` (beheizter Raum) |
| Raum (passiv) | `waermeLieferanten[].raumId` | `raeume[].id` (beheizte Räume, Summe der Prozente 100) |

Bei `angrenzend.art` `"aussen"` gibt es kein weiteres Feld. Bei `"zone"` steht nur `zoneId`, bei `"raum"` nur `raumId`.

**Pflicht (P) und optional (o)** je Bereich. „P“ heißt: ohne den Wert ist der Eintrag nicht berechenbar oder wird in der App
als fehlerhaft markiert.

| Bereich | Pflicht | Optional |
|---|---|---|
| `einstellungen` | nichts (fehlende Felder erhalten Standardwerte) | alle Felder |
| `zonen` | `id`, `name`, `art`, `temperatur.min`, `temperatur.max` | `notiz` |
| `bauteile` | `id`, `name`, `art`, `u.min`, `u.max` (größer 0), `quelle` | `aufbau` |
| `oeffnungstypen` | `id`, `name`, `art`, `uw` (größer 0), `quelle` | |
| `raeume` | `id`, `name`, `geschoss`, `status`, `theta` (bei `unbeheizt` darf `null` sein), `flaeche` und `hoehe` (oder `volumenManuell`), bei `passiv` die `waermeLieferanten` | `volumenManuell`, `luftwechsel`, `plan`, `notiz` |
| `raumflaechen` | `id`, `raumId`, `bauteilId`, `angrenzend`, `modus` und dazu passend `laenge` + `hoehe` oder `flaeche` | `name`, `notiz`, `oeffnungen` (Liste, darf leer sein) |
| Öffnung | `id`, `typId`, `modus` und dazu passend `laenge` (Breite) + `hoehe` oder `flaeche`, `anzahl` (ganze Zahl ab 1) | `name` |
| `heizkoerper` | `id`, `raumId`, `bauart`, `status`, `ventil`; außer bei `wp`: `normVorlauf`, `normRuecklauf`, `normRaum`; für die Berechnung außerdem die Leistung (`normleistung`, bei Gliedern auch `gliederzahl` mit `leistungJeGlied`; bei `wp` die `kennlinie` mit mindestens zwei Paaren und `kennlinieRaumtemperatur`) | Maße, `typ`, `material`, `exponent`, `notiz` |
| `verbrauch` | `id`, `name`, `gasKwh`, `nichtFuerHeizungKwh`, `kesselNutzungsgrad`, `innentemperaturIst`, `innentemperaturSoll`, mindestens ein Monat mit `heizmonat: true` samt `gradtage` und `heiztage`; bei `holzRm` größer 0 auch `heizwertRm` und `ofenWirkungsgrad` | `holzRm` (`null` ohne Holz), `notiz` |

**Erlaubte Werte** (Auswahlfelder):

| Feld | Werte |
|---|---|
| `zonen[].art` | `erdreich`, `unbeheizt`, `nachbar` |
| `bauteile[].art` | `aussenwand`, `dach`, `kellerdecke`, `bodenplatte`, `erdberuehrteWand`, `nachbarwand`, `innenwand`, `innendecke` |
| `bauteile[].quelle`, `oeffnungstypen[].quelle` | `rechnung`, `stempel`, `schaetzung` |
| `oeffnungstypen[].art` | `fenster`, `tuer` |
| `raeume[].geschoss` | `EG`, `Keller` (weitere Geschosse gibt es derzeit nicht) |
| `raeume[].status` | `beheizt`, `passiv`, `unbeheizt` |
| `raumflaechen[].modus`, Öffnung `modus` | `laengeHoehe`, `flaeche` |
| `raumflaechen[].angrenzend.art` | `aussen`, `zone`, `raum` |
| `heizkoerper[].bauart` | `platten`, `glieder`, `handtuch`, `wp`, `sonstige` |
| `heizkoerper[].typ` | `""`, `11`, `21`, `22`, `33`, `andere` |
| `heizkoerper[].status` | `bleibt`, `entfaellt`, `neu`, `geplant` |
| `heizkoerper[].material` | `""`, `stahl`, `guss`, `aluminium`, `sonstiges` |
| `heizkoerper[].ventil` | `neu`, `alt` |

## Vorbereitet für spätere Stufen

`fotos`, `markierungen` und `szenarien` sind Listen und derzeit **leer**. In Stufe 2 kommen die Fotos (verkleinert, in
der Datei enthalten) und Markierungen hinzu, die auf Öffnungen und Heizkörper verweisen. In Stufe 3 folgen die
Szenarien. Alte Dateien bleiben lesbar.

## Hinweise für die Umwandlung einer Tabelle

1. Räume zuerst, dann Bauteile, Zonen, Öffnungstypen, danach Raumflächen und Heizkörper. So sind alle Verweise bekannt.
2. Jede Zeile bekommt eine eindeutige, dauerhafte `id`. Zum Beispiel `raum-` und ein Kürzel.
3. Nichts schätzen, was die Tabelle nicht hergibt: lieber `null`. Die App markiert Fehlendes.
4. Bei Heizkörpern die **Normbedingungen der jeweiligen Tabelle** eintragen (55/45/20, 75/65/20, 90/70/20 ...).
5. Passive Räume: `status` auf `passiv` und `waermeLieferanten` mit Prozent, Summe 100.
6. Nach dem Import zeigt die App unter „Räume“ die Gegenprobe der Gebäudesumme. Sie muss null Differenz zeigen.
