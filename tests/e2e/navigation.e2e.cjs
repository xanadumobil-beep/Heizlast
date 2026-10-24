// Browser-Test der Navigation (Playwright, Chromium). Voraussetzung: App läuft unter ADRESSE, zum Beispiel
//   python3 -m http.server 8780      und dann      node tests/e2e/navigation.e2e.cjs
// Prüft: Hauptband ohne seitliches Scrollen (iPad hoch und quer, iPhone), jeder Bereich und jeder Unterreiter über das Menü,
// Merken der letzten Seite, Sprünge im Inhalt, Löschen-Knopf abgesetzt.
const { chromium } = require('playwright');

const ADRESSE = process.env.ADRESSE ?? 'http://localhost:8780/';
const BEISPIEL = process.env.BEISPIEL ?? `${__dirname}/../../examples/beispiel-mini-haus.json`;
let fehler = 0;
const pruefe = (bedingung, text) => { if (!bedingung) { fehler += 1; console.log(`✘ ${text}`); } else console.log(`✔ ${text}`); };

(async () => {
  const browser = await chromium.launch();
  const kontext = await browser.newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: 'block' });
  const seite = await kontext.newPage();
  const fehlerSeite = [];
  seite.on('pageerror', (e) => fehlerSeite.push(e.message));
  seite.on('dialog', (d) => d.accept());

  await seite.goto(`${ADRESSE}#sicherung`);
  await seite.setInputFiles('input[type=file]', BEISPIEL);
  await seite.getByRole('button', { name: 'Daten ersetzen' }).click();
  await seite.waitForTimeout(500);
  await seite.goto(`${ADRESSE}#ergebnis`);
  await seite.waitForSelector('[data-benoetigt]');

  const hauptband = async () => seite.evaluate(() => {
    const n = document.getElementById('navigation');
    const r = [...n.querySelectorAll('a')].map((a) => a.getBoundingClientRect());
    return { scroll: n.scrollWidth, breite: n.clientWidth, anzahl: r.length, links: Math.min(...r.map((x) => x.left)), rechts: Math.max(...r.map((x) => x.right)), fenster: window.innerWidth };
  });
  for (const [name, w, h] of [['iPad hoch', 820, 1180], ['iPad quer', 1180, 820], ['iPad mini hoch', 744, 1133], ['iPhone', 390, 844]]) {
    await seite.setViewportSize({ width: w, height: h });
    const m = await hauptband();
    pruefe(m.anzahl === 8 && m.scroll <= m.breite && m.links >= 0 && m.rechts <= m.fenster, `${name}: acht Punkte, ohne seitliches Scrollen (${m.scroll}/${m.breite})`);
    const ersterText = await seite.locator('#navigation a').first().evaluate((a) => { const s = [...a.querySelectorAll('span')].filter((x) => getComputedStyle(x).display !== 'none'); return s.map((x) => x.textContent).join(' '); });
    if (w <= 600) pruefe(ersterText.includes('📊') && ersterText.includes('Ergeb.'), `${name}: Symbol mit kurzem Text (${ersterText})`);
    else pruefe(ersterText.includes('Ergebnis'), `${name}: Text „Ergebnis“ sichtbar`);
  }
  await seite.setViewportSize({ width: 820, height: 1180 });

  const titel = async () => (await seite.locator('main h2').first().innerText()).trim();
  const bereiche = [
    ['ergebnis', 'Ergebnis', ['Ergebnis']],
    ['gebaeude', 'Räume', ['Räume', 'Plan']],
    ['heizkoerper', 'Heizkörper & Vorlauf', ['Heizkörper & Vorlauf']],
    ['szenarien', 'Szenarien', ['Szenarien']],
    ['abgleich', 'Verbrauchsabgleich', ['Verbrauchsabgleich']],
    ['bericht', 'Bericht', ['Bericht']],
    ['grundlagen', 'Bauteile', ['Bauteile', 'Öffnungen', 'Zonen', 'Wärmepumpen', 'Rechenannahmen']],
    ['system', 'Sicherung', ['Sicherung', 'App']],
  ];
  const kopfTexte = { Ergebnis: 'Ergebnis', Räume: 'Räume', Plan: 'Plan', 'Heizkörper & Vorlauf': 'Heizkörper & Vorlauf', Szenarien: 'Szenarien', Verbrauchsabgleich: 'Verbrauchsabgleich', Bericht: 'Bericht', Bauteile: 'Bauteile', Öffnungen: 'Öffnungen', Zonen: 'Zonen', Wärmepumpen: 'Wärmepumpen', Rechenannahmen: 'Rechenannahmen', Sicherung: 'Sicherung', App: 'App' };
  for (const [id, erste, unter] of bereiche) {
    await seite.click(`#navigation a[data-bereich="${id}"]`);
    await seite.waitForTimeout(250);
    pruefe(await seite.locator(`#navigation a[data-bereich="${id}"]`).getAttribute('aria-current') === 'page', `${id}: Hauptpunkt gewählt`);
    const sichtbar = await seite.locator('#unterreiter').isVisible();
    pruefe(sichtbar === unter.length > 1, `${id}: Unterreiter ${unter.length > 1 ? 'sichtbar' : 'verborgen'}`);
    for (const u of unter) {
      if (unter.length > 1) { await seite.click(`#unterreiter a:text-is("${u}")`); await seite.waitForTimeout(250); }
      pruefe((await titel()).includes(kopfTexte[u]), `${id} → ${u}: Seite „${await titel()}“`);
    }
    if (unter.length > 1) {
      const nurEiner = await seite.locator('#unterreiter a[aria-current]').count();
      pruefe(nurEiner === 1, `${id}: genau ein Unterreiter gewählt`);
    }
  }

  // Merken: Grundlagen → Zonen, weg und zurück, dann neu laden
  await seite.click('#navigation a[data-bereich="grundlagen"]');
  await seite.click('#unterreiter a:text-is("Zonen")');
  await seite.click('#navigation a[data-bereich="ergebnis"]');
  await seite.click('#navigation a[data-bereich="grundlagen"]');
  await seite.waitForTimeout(200);
  pruefe((await titel()).includes('Zonen'), 'Grundlagen öffnet die zuletzt gewählte Seite (Zonen)');
  await seite.goto(ADRESSE);
  await seite.waitForTimeout(600);
  pruefe((await titel()).includes('Zonen'), 'Start ohne Link öffnet die zuletzt geöffnete Seite');

  // Sprünge: Ergebnis → Plan, Plan → Zonen, Plan → Raumdetail, alter Link #einstellungen
  await seite.goto(`${ADRESSE}#plan`);
  await seite.waitForSelector('.pl-raum, svg');
  pruefe((await seite.locator('#unterreiter a[aria-current]').innerText()) === 'Plan', 'Plan: Unterreiter „Plan“ gewählt');
  await seite.goto(`${ADRESSE}#einstellungen`);
  await seite.waitForTimeout(300);
  pruefe((await titel()) === 'Rechenannahmen', 'alter Link #einstellungen öffnet Rechenannahmen');
  const felder = await seite.locator('main .formular .beschriftung').allInnerTexts();
  pruefe(felder[0] === 'Projektname' && felder.includes('Sperrzeit des Netzbetreibers') && felder.includes('Ziel-Vorlauftemperatur'), `Rechenannahmen: Projektname zuerst, Ziel-Vorlauf und Sperrzeit enthalten (${felder.length} Felder)`);
  await seite.goto(`${ADRESSE}#app`);
  await seite.waitForTimeout(400);
  const appText = await seite.locator('main').innerText();
  pruefe(appText.includes('App-Version') && appText.includes('Dauerhafter Speicher') && appText.includes('App-Speicher leeren'), 'App: Version, Updates, App-Speicher, dauerhafter Speicher');

  // Wärmepumpen-Katalog: Beispielkatalog importieren, Geräteprüfung im Ergebnis
  await seite.goto(`${ADRESSE}#waermepumpen`);
  await seite.waitForSelector('input[type=file]', { state: 'attached' });
  await seite.setInputFiles('input[type=file]', `${__dirname}/../../examples/beispiel-waermepumpen.json`);
  await seite.getByRole('button', { name: 'Katalog ersetzen' }).click();
  await seite.waitForSelector('[data-geraet="Beispiel-Hersteller Alpha 9"]');
  pruefe(await seite.locator('.geraet-karte').count() === 2, 'Katalog importiert: zwei Geräte');
  await seite.locator('[data-geraet="Beispiel-Hersteller Alpha 9"] button:text-is("Bearbeiten")').click();
  await seite.waitForSelector('dialog .punktetabelle');
  pruefe(await seite.locator('dialog .punktetabelle tbody tr').count() === 6, 'Bearbeiten: sechs Leistungspunkte in der Tabelle');
  await seite.click('dialog .punktetabelle >> text=+ Zeile');
  pruefe(await seite.locator('dialog .punktetabelle tbody tr').count() === 7, 'Neue Zeile hinzufügen');
  await seite.locator('dialog button:text-is("Speichern")').click();
  await seite.waitForSelector('dialog', { state: 'detached' });
  pruefe(await seite.locator('[data-geraet="Beispiel-Hersteller Alpha 9"] table.punkte tbody tr').count() === 6, 'Speichern: leere Zeile wird ausgelassen, sechs Punkte bleiben');
  await seite.goto(`${ADRESSE}#ergebnis`);
  await seite.waitForSelector('[data-geraetepruefung] .geraet-pruefung');
  const stufen = await seite.locator('[data-geraetepruefung] .geraet-pruefung').evaluateAll((l) => l.map((x) => `${x.dataset.geraet}:${x.dataset.stufe}`));
  pruefe(stufen.join() === 'Beispiel-Hersteller Alpha 9:B,Beispiel-Hersteller Beta 6:A', `Geräteprüfung: geprüft vor vorausgewählt (${stufen})`);
  const alpha = await seite.locator('[data-geraet="Beispiel-Hersteller Alpha 9"].geraet-pruefung').innerText();
  pruefe(alpha.includes('Deckung bei Auslegung') && alpha.includes('Bivalenzpunkt') && alpha.includes('Taktprüfung'), 'Karte Stufe B zeigt Deckung, Bivalenzpunkt und Takt');
  const beta = await seite.locator('[data-geraet="Beispiel-Hersteller Beta 6"].geraet-pruefung').innerText();
  pruefe(beta.includes('Vorauswahl') && beta.includes('−10 °C'), 'Karte Stufe A: Vorauswahl mit Hinweis');
  await seite.selectOption('[data-sortierung]', 'name');
  pruefe(await seite.locator('[data-geraetepruefung] .geraet-pruefung').count() === 2, 'Sortierung ändern');

  // Karten: Löschen rechts abgesetzt, in derselben Zeile wie Bearbeiten und Kopieren
  await seite.goto(`${ADRESSE}#zonen`);
  await seite.waitForSelector('.karte .knopfzeile');
  const zeile = await seite.locator('.karte .knopfzeile').first().evaluate((z) => {
    const b = [...z.querySelectorAll('button')].map((x) => ({ t: x.textContent, r: x.getBoundingClientRect() }));
    const bearb = b.find((x) => x.t === 'Bearbeiten'); const kop = b.find((x) => x.t === 'Kopieren'); const del = b.find((x) => x.t === 'Löschen');
    return { gleicheZeile: Math.abs(bearb.r.top - del.r.top) < 12 && Math.abs(kop.r.top - bearb.r.top) < 12, rechts: del.r.left > kop.r.right + 20, kleiner: del.r.height <= bearb.r.height };
  });
  pruefe(zeile.gleicheZeile && zeile.rechts && zeile.kleiner, `Karte: Löschen kleiner und rechts abgesetzt (${JSON.stringify(zeile)})`);
  seite.removeAllListeners('dialog');
  let frage = null;
  seite.once('dialog', async (d) => { frage = d.message(); await d.dismiss(); });
  await seite.locator('.karte button.loeschen').first().click();
  pruefe(Boolean(frage), `Löschen fragt nach (${frage?.slice(0, 40)})`);

  pruefe(fehlerSeite.length === 0, `keine Skriptfehler ${fehlerSeite.join('; ')}`);
  await browser.close();
  process.exitCode = fehler === 0 ? 0 : 1;
  console.log(fehler === 0 ? '\nAlle Browser-Prüfungen bestanden.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
})();
