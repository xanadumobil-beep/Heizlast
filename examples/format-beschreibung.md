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
| `schemaVersion` | derzeit `3` (Version 1 ohne Szenarien und Version 2 ohne Fotos bleiben lesbar, neuere Versionen werden abgelehnt) |
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

Optional, nur für `art: "unbeheizt"`: `geschoss` (`""`, `EG` oder `Keller`; leer heißt automatisch: Keller, sonst das unterste
Geschoss) und `plan` (`null` oder `{ "x": 0 bis 100, "y": 0 bis 100 }`, Mittelpunkt des Kastens in Prozent der Zeichenfläche des
Geschosses, wie bei den Räumen). Unbeheizte Zonen erscheinen im Plan als verschiebbare Kästen, Erdreich und Nachbar als Randsymbole.

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
| `zonen` | `id`, `name`, `art`, `temperatur.min`, `temperatur.max` | `notiz`, `geschoss`, `plan` |
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

## `daten.einstellungen.waermepumpe` (optional)

Annahmen für den Bereich „Ergebnis“: `{ "sperrstunden": 2 }`. Sperrzeit des Netzbetreibers in Stunden je Tag (0 bis unter 24). Fehlt das Feld,
gilt 0 und es gibt keinen Zuschlag. Zuschlag = Heizlast · 24 / (24 − Sperrstunden) − Heizlast. Alte Dateien ohne dieses Feld bleiben lesbar.

## `daten.einstellungen.vergleich` (optional)

Annahmen für die Jahreswärme-Differenz im Szenarienvergleich: `{ "gradtage": { "quelle": "verbrauch" | "manuell", "verbrauchId": "<id>" | null,
"manuell": 3000 | null }, "jaz": { "min": 3, "max": 4 }, "strompreis": { "min": 28, "max": 34 } }`. `jaz` (Jahresarbeitszahl) und `strompreis` (ct/kWh) sind optional
(`null`-Werte: keine Stromrechnung). Die Gradtagzahl G stammt aus der Summe der Heizmonate eines Verbrauchsdatensatzes, umgerechnet auf die mittlere
Soll-Temperatur der Räume, oder wird manuell in Kd eingegeben. Gerechnet wird ΔH = ΔΦ / (θ_soll,Mittel − θ_e), ΔQ = ΔH · 24 · G / 1000 und optional
ΔStrom = ΔQ / JAZ mit Kosten = ΔStrom · Strompreis / 100. Das Ergebnis ist eine Schätzung aus der Heizlast, Fremdwärme und Nutzerverhalten sind nicht berücksichtigt.

## `daten.szenarien`

Ein Szenario beschreibt **Abweichungen** gegenüber dem Ist-Zustand (den normalen Projektdaten). Der Ist-Zustand wird durch Szenarien
nie verändert. Fehlende Teile ergänzt die App beim Import mit Leerwerten.

| Feld | Bedeutung |
|---|---|
| `id`, `name`, `beschreibung`, `erstelltAm` | Kennung (Pflicht), Name, Text, Zeitpunkt (ISO) |
| `kosten` | `{ "investition": { "min": 8000, "max": 12000 }, "foerderung": { "min": 2000, "max": 3000 }, "quelle": "Angebot Dachdecker vom …" }`. Reine Eingabe in €, die App schätzt keine Kosten. Leere Werte (`null`) heißen „nicht angegeben“; fehlt die Förderung, gilt sie als 0 €. Kosten nach Förderung = Investition minus Förderung (niedrigste Investition mit höchster Förderung bis höchste Investition mit niedrigster Förderung). |
| `abweichungen.bauteile` | `{ "<bauteilId>": { "name": "Flachdach", "u": { "min": 0.2, "max": 0.2 } } }` überschreibt den U-Wert |
| `abweichungen.oeffnungstypen` | `{ "<typId>": { "name": "...", "uw": 1.0 } }` überschreibt den Uw-Wert |
| `abweichungen.heizkoerperStatus` | `{ "<heizkoerperId>": { "name": "...", "status": "entfaellt" } }`, Status wie bei den Heizkörpern |
| `abweichungen.neueHeizkoerper` | Liste vollständiger Heizkörper wie in `heizkoerper` (mit `id`, `raumId`, Normbedingungen oder Kennlinie), die nur in diesem Szenario existieren; zusätzlich `name` |
| `abweichungen.raumTemperatur` | `{ "<raumId>": { "name": "...", "theta": 21 } }` überschreibt die Soll-Temperatur |
| `abweichungen.luftwechselStandard` | `null` oder `{ "min": 0.4, "max": 0.6 }` überschreibt den Standard-Luftwechsel |
| `abweichungen.luftwechselRaum` | `{ "<raumId>": { "name": "...", "min": 0.3, "max": 0.5 } }` überschreibt den Luftwechsel eines Raums |
| `abweichungen.einstellungen` | `{ "zielVorlauf": 40, "spreizung": 7 }`, beide Felder optional |

`name` in den Einträgen ist eine Merkhilfe: Wird das Ziel im Ist-Zustand später gelöscht, nennt die App den Namen im Hinweis. Verweist eine
Abweichung auf etwas, das es nicht (mehr) gibt, wirkt sie nicht, und die App zeigt einen Hinweis. Die Kennung eines szenario-eigenen
Heizkörpers darf nicht mit einem Heizkörper des Ist-Zustands übereinstimmen.

## `daten.fotos`, `daten.markierungen`, `daten.hintergruende` (ab Version 3)

Fotos und Baupläne sind optional. Eine Sicherung **ohne Fotos** hat diese drei Listen leer. Bilddaten stehen als data-URL (Base64) in der Datei,
darum ist eine Sicherung mit Fotos deutlich größer. Die App zeigt die Größe vorab.

**Fotos** (`fotos`): je Foto `id`, `raumId`, `titel`, `notiz`, `datum` (ISO), `breite`, `hoehe` (Pixel), `bild` (data-URL des verkleinerten JPEG,
lange Seite höchstens 2048 px) und `vorschau` (kleines JPEG, optional). Einträge ohne `bild` werden beim Import ausgelassen und gemeldet.

**Markierungen** (`markierungen`): je Markierung `id`, `fotoId`, `raumId`, `x`, `y` (Position in **Prozent des Bildes**, 0 bis 100, Ursprung links oben),
`ziel` (`null` für frei beschriftet, sonst `{ "art": "oeffnung" | "heizkoerper" | "flaeche", "id": "<Id>" }`), `beschriftung` und `auto`
(`true`: die Beschriftung folgt der Verknüpfung, zum Beispiel „F1 Hebeschiebeanlage“ oder „HK2 Typ 22“; `false`: eigener Text). Verweist `ziel` auf ein
gelöschtes Element, bleibt die Markierung erhalten und die App zeigt „Verknüpfung fehlt“.

**Baupläne** (`hintergruende`): je Geschoss höchstens einer, `id` ist `bg-<Geschoss>` (zum Beispiel `bg-EG`), dazu `geschoss`, `bild` (data-URL), `breite`, `hoehe`,
`drehung` (0, 90, 180 oder 270 Grad im Uhrzeigersinn), `deckkraft` (0 bis 1) und `sichtbar`. Die Zeichenfläche des Geschosses nimmt das
Seitenverhältnis des (gedrehten) Bildes an. Die Prozent-Positionen der Raum- und Zonenkästen (`plan`) bleiben gültig.

**Nicht ins öffentliche Repository:** Fotos und Baupläne enthalten echte Hausdaten (oft auch Namen und Adressen im Schriftfeld). Das Beispielhaus enthält keine.

## `daten.waermepumpen` (ab Version 4)

Katalog der Wärmepumpen. Je Gerät: `id`, `hersteller`, `modell`, `typ` (genaue Typbezeichnung), `anbieter`, `preis` (`{ min, max }` in € oder `null`), `datenblatt` (Link als Text, die App ruft nichts ab),
`notiz`, `schall` (Schallleistungspegel Außengerät in dB(A) oder `null`), `bafa` und `punkte`.

`bafa`: `{ foerderfaehig: "ja" | "nein" | "unbekannt", nennleistung55 (kW, BAFA-Nennleistung bei 55 °C, nur für die Vorauswahl), eta35, eta55 (ETAs in %), kaeltemittel, stand (Datum JJJJ-MM-TT) }`.
Die BAFA-Nennleistung ist kein Auslegungswert.

`punkte`: Leistungspunkte aus dem Datenblatt, beliebig viele: `{ aussen (°C), vorlauf (°C), max (kW, maximale Heizleistung), min (kW, minimale Heizleistung, optional), cop (optional) }`.
Pflicht für die Prüfung: `max` bei A−7 mit W35 und W55 sowie ein Punkt mit `min` bei A7 oder höher. Fehlt etwas, zeigt die App „nicht prüfbar“ und nennt, was fehlt.
Dateien vor Version 4 haben diese Liste nicht: Beim Import bleibt der vorhandene Katalog dann unverändert. Enthält die Datei die Liste (auch leer), ersetzt sie den Katalog.

### Katalogdatei

Der Katalog lässt sich ohne Hausdaten als eigene Datei tauschen (`format` = `heizlast-waermepumpenkatalog`). Die vollständige Beschreibung aller Felder mit Einheiten, Pflicht und erlaubten Werten,
samt Beispiel und Checkliste für extern erstellte Dateien, steht in **`examples/format-katalog.md`**. Ein erfundenes Beispiel liegt in `examples/beispiel-waermepumpen.json`.

### Geräteprüfung (Bereich Ergebnis)

Stufe A „Vorauswahl“ (nur BAFA-Werte): Verhältnis aus BAFA-Nennleistung 55 °C und oberer Grenze der Gebäudeheizlast. Grün 0,9 bis 1,3, gelb 0,75 bis 0,9 und 1,3 bis 1,6, sonst rot.
Die BAFA-Nennleistung bezieht sich auf eine Auslegung bei −10 °C (EU-Durchschnittsklima), die Vorauswahl ist keine Auslegung.
Stufe B „Prüfung“ (mit Datenblattpunkten, ersetzt die Vorauswahl): maximale Leistung bei θ_e und nötigem Vorlauf Y linear zwischen den Punkten (höchstens 3 K Fortsetzung darüber hinaus),
Deckung gegen die obere Grenze, Bivalenzpunkt gegen die Heizlastlinie der oberen Grenze, Taktprüfung, Effizienz (ETAs linear bei Y) und Schall.
Taktprüfung: Der Vorlauf je Außentemperatur kommt aus der linearen Heizkurve t_V(θ) = θ_soll + (Y − θ_soll) · (θ_soll − θ) / (θ_soll − θ_e), mindestens 25 °C. Die minimale Leistung bei +7 °C und +2 °C wird bei diesem
Vorlauf aus den Datenblattpunkten interpoliert (sonst gilt der nächstliegende Punkt). Grün: minimale Leistung bei +7 °C höchstens die Heizlast (untere Grenze) bei +7 °C, gelb: erst bei +2 °C, sonst rot.
Effizienz und Schall sind eine Rangfolge der Geräte untereinander, der echte Wert steht daneben. Es gibt keine Gesamtnote.

## `daten.einstellungen.geraetepruefung` (optional)

Ampelgrenzen der Geräteprüfung, einstellbar unter Grundlagen → Rechenannahmen: `{ "bivalenzGruen": -4, "bivalenzGelb": -1, "deckungGruen": 80, "deckungGelb": 65 }`.
Bivalenzpunkt in °C: grün bis `bivalenzGruen`, gelb bis `bivalenzGelb`, darüber rot. Deckung bei θ_e in %: grün ab `deckungGruen`, gelb ab `deckungGelb`, darunter rot. Fehlt der Block oder ein Wert, gilt der Standard (die hier genannten Werte).

## Vorbereitet für spätere Stufen

Die Stufen 1 bis 3 und der Wärmepumpen-Katalog sind umgesetzt. Neue Felder bleiben abwärtskompatibel: Alte Dateien lassen sich weiter lesen.
