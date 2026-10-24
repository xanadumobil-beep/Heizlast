// Hinweis-Banner, wenn die letzte Sicherung älter als 14 Tage ist.

import * as db from './db.js';
import { el, ersetzeKinder } from './ui.js';
import { sicherungsStatus, bannerText } from './io.js';

export async function aktualisiereBanner() {
  const banner = document.getElementById('banner');
  if (!banner) return;
  const [sicherung, start] = await Promise.all([db.ladeSicherung(), db.lade('meta', 'init')]);
  const text = bannerText(sicherungsStatus({
    jetzt: new Date(), letzteSicherung: sicherung?.zeit ?? null, start: start?.datum ?? null,
  }));
  banner.hidden = text === null;
  if (text !== null) {
    ersetzeKinder(banner, el('p', {}, el('strong', {}, '⚠ Sicherung fällig: '), text), el('a', { class: 'knopf', href: '#sicherung' }, 'Jetzt sichern'));
  }
}
