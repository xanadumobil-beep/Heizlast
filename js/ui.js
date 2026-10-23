// Kleine Hilfen für die Oberfläche: Elemente bauen und Formulare aus Feldlisten erzeugen.
// Zahlenfelder sind Textfelder mit inputmode="decimal". So bleibt das Komma als
// Dezimaltrennzeichen erhalten, was bei type="number" auf dem iPad nicht verlässlich ist.

import { parseDezimal, zahlZuText } from './engine/format.js';

export function el(tag, eigenschaften = {}, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [name, wert] of Object.entries(eigenschaften)) {
    if (wert === undefined || wert === null || wert === false) continue;
    if (name === 'class') knoten.className = wert;
    else if (name.startsWith('on')) knoten.addEventListener(name.slice(2).toLowerCase(), wert);
    else knoten.setAttribute(name, wert === true ? '' : wert);
  }
  for (const kind of kinder.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    knoten.append(kind.nodeType ? kind : document.createTextNode(String(kind)));
  }
  return knoten;
}

// Wert unter einem Pfad wie "aufheizzuschlag.wProM2" lesen und setzen.
export function holeWert(objekt, pfad) {
  return pfad.split('.').reduce((o, teil) => o?.[teil], objekt);
}

export function setzeWert(objekt, pfad, wert) {
  const teile = pfad.split('.');
  let ziel = objekt;
  for (const teil of teile.slice(0, -1)) ziel = ziel[teil] ??= {};
  ziel[teile.at(-1)] = wert;
}

function textfeld(wert, beiAenderung, zahlenfeld) {
  return el('input', {
    type: 'text',
    value: wert,
    autocomplete: 'off',
    autocapitalize: zahlenfeld ? 'off' : 'sentences',
    inputmode: zahlenfeld ? 'decimal' : 'text',
    enterkeyhint: 'done',
    onInput: beiAenderung,
  });
}

function mitEinheit(eingabe, einheit) {
  return einheit ? el('span', { class: 'mit-einheit' }, eingabe, el('span', { class: 'einheit' }, einheit)) : eingabe;
}

// Baut ein einzelnes Feld. Liefert das Element und eine Funktion, die den Wert liest.
function baueFeld(feld, wert, beiAenderung) {
  switch (feld.typ) {
    case 'text': {
      const eingabe = textfeld(wert ?? '', beiAenderung, false);
      return { eingabe: eingabe, lies: () => eingabe.value.trim() };
    }
    case 'notiz': {
      const eingabe = el('textarea', { rows: 4, onInput: beiAenderung });
      eingabe.value = wert ?? '';
      return { eingabe, lies: () => eingabe.value.trim() };
    }
    case 'zahl': {
      const eingabe = textfeld(zahlZuText(wert), beiAenderung, true);
      return { eingabe: mitEinheit(eingabe, feld.einheit), lies: () => parseDezimal(eingabe.value) };
    }
    case 'bereich': {
      const min = textfeld(zahlZuText(wert?.min), beiAenderung, true);
      const max = textfeld(zahlZuText(wert?.max), beiAenderung, true);
      const eingabe = el(
        'div', { class: 'bereich' },
        el('label', {}, el('span', { class: 'klein' }, 'Minimum'), mitEinheit(min, feld.einheit)),
        el('label', {}, el('span', { class: 'klein' }, 'Maximum'), mitEinheit(max, feld.einheit)),
      );
      return { eingabe, lies: () => ({ min: parseDezimal(min.value), max: parseDezimal(max.value) }) };
    }
    case 'auswahl': {
      const eingabe = el(
        'select', { onChange: beiAenderung },
        feld.optionen.map((o) => el('option', { value: o.wert }, o.label)),
      );
      eingabe.value = wert;
      return { eingabe, lies: () => eingabe.value };
    }
    case 'schalter': {
      const eingabe = el('input', { type: 'checkbox', onChange: beiAenderung });
      eingabe.checked = Boolean(wert);
      return { eingabe, lies: () => eingabe.checked, inline: true };
    }
    default:
      throw new Error(`Unbekannter Feldtyp: ${feld.typ}`);
  }
}

// Erzeugt ein Formular. Rückgabe: { element, lies(), zeigeMeldungen(meldungen) }.
// beiAenderung wird bei jeder Eingabe aufgerufen.
export function baueFormular(felder, werte, beiAenderung = () => {}) {
  const wurzel = el('div', { class: 'formular' });
  const allgemein = el('div', { class: 'meldungen allgemein', 'aria-live': 'polite' });
  const eintraege = [];

  wurzel.append(allgemein);
  for (const feld of felder) {
    const { eingabe, lies, inline } = baueFeld(feld, holeWert(werte, feld.key), beiAenderung);
    const meldungen = el('div', { class: 'meldungen', 'aria-live': 'polite' });
    // Bereichsfelder enthalten eigene Labels, die übrigen werden vom Label umschlossen.
    const zeile = feld.typ === 'bereich'
      ? el('div', { class: 'feld' }, el('span', { class: 'beschriftung' }, feld.label), eingabe, hinweis(feld), meldungen)
      : el(
        'label', { class: inline ? 'feld inline' : 'feld' },
        el('span', { class: 'beschriftung' }, feld.label), eingabe, hinweis(feld), meldungen,
      );
    wurzel.append(zeile);
    eintraege.push({ feld, lies, zeile, meldungen });
  }

  return {
    element: wurzel,
    lies() {
      const ergebnis = {};
      for (const { feld, lies } of eintraege) setzeWert(ergebnis, feld.key, lies());
      return ergebnis;
    },
    zeigeMeldungen(liste) {
      allgemein.replaceChildren();
      for (const e of eintraege) {
        e.meldungen.replaceChildren();
        e.zeile.classList.remove('hat-fehler', 'hat-warnung');
      }
      for (const m of liste) {
        const ziel = eintraege.find((e) => e.feld.key === m.feld);
        const absatz = el('p', { class: `meldung ${m.stufe}` }, (m.stufe === 'fehler' ? '✕ ' : '⚠ ') + m.text);
        if (ziel) {
          ziel.meldungen.append(absatz);
          ziel.zeile.classList.add(m.stufe === 'fehler' ? 'hat-fehler' : 'hat-warnung');
        } else {
          allgemein.append(absatz);
        }
      }
    },
  };
}

function hinweis(feld) {
  return feld.hinweis ? el('span', { class: 'hinweis' }, feld.hinweis) : null;
}
