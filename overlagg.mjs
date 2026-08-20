/*
 * overlagg.mjs — ritar ETT genomskinligt PNG-överlägg per klipp.
 *
 * Nio PNG, inte 780 filmrutor. Rörelsen (Ken Burns) görs av ffmpeg på fotot
 * under; det här lagret står stilla och tonas in med alfa.
 *
 * ★ Motorn som ritar är motor/some-motor.js — EXAKT samma fil som webbläsaren
 *   använder för förhandsvisningen. Kopiera aldrig ritkod hit.
 *
 * ⚠ DEN HÄR HALVAN ÄR OTESTAD PÅ RIKTIG RUNNER (per 20 aug 2026). Chromium gick
 *   inte att ladda ner i utvecklingssandlådan. Första skarpa körningen är provet.
 */

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HAR = dirname(fileURLToPath(import.meta.url));
const UT = join(HAR, 'ut');

const specSokvag = process.argv[2] || join(HAR, 'spec.json');
const spec = JSON.parse(await readFile(specSokvag, 'utf8'));

const B = spec.bredd || 1080;
const H = spec.hojd || 1920;

const motorKod = await readFile(join(HAR, 'motor', 'some-motor.js'), 'utf8');

await mkdir(UT, { recursive: true });

const sida = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;background:transparent}
  canvas{display:block;background:transparent}
</style>
</head><body>
<canvas id="duk" width="${B}" height="${H}"></canvas>
<script>${motorKod}</script>
</body></html>`;

const webblasare = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const kontext = await webblasare.newContext({
  viewport: { width: B, height: H },
  deviceScaleFactor: 1
});
const sidan = await kontext.newPage();
await sidan.setContent(sida, { waitUntil: 'networkidle' });

/*
 * ★★ AVBRYT HELLRE ÄN ATT RENDERA I FEL TYPSNITT.
 * Om Jost inte laddat faller canvas tillbaka på sans-serif utan att säga något,
 * och felet upptäcks först när någon tittar på den färdiga filmen. Bättre att
 * hela körningen dör här med ett tydligt meddelande.
 */
const typsnittOk = await sidan.evaluate(async (stil) => {
  /*
   * ★★ CANVAS TRIGGAR INTE NEDLADDNING AV WEBBTYPSNITT.
   * Ett snitt som bara är deklarerat i CSS men aldrig används av ett DOM-element
   * hämtas aldrig hem. document.fonts.ready resolvar direkt (det finns inget
   * pågående att vänta på) och check() svarar false hur länge man än väntar.
   * ctx.font = '... Jost' räcker inte heller — canvas är inte DOM.
   * Varje snitt och vikt måste begäras EXPLICIT med document.fonts.load().
   *
   * ★ Listan kommer från MOTORN, inte härifrån. Hårdkodas den här glöms nya
   *   vikter bort när motorn ändras — t.ex. hjältesiffrans 300 200px Jost, som
   *   tillkom med faktakortet och tyst hade ritats i Arial.
   */
  const begar = window.SomeMotor.typsnittSomBehovs(stil);
  await Promise.all(begar.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  return begar.every((f) => document.fonts.check(f));
}, spec.stil || {});

if (!typsnittOk) {
  await webblasare.close();
  console.error('AVBROTT: Jost och/eller Inter laddade inte. Renderar hellre inget alls än i Arial.');
  process.exit(2);
}

// Bilderna hämtas som data-URI så att Chromium slipper nätverksanrop mitt i
// ritningen. Servern hämtar dem utan CORS-hinder — CORS finns bara i webbläsaren.
const somDataUri = async (url, vad) => {
  if (!url) return null;
  try {
    const svar = await fetch(url);
    if (!svar.ok) throw new Error('HTTP ' + svar.status);
    const buf = Buffer.from(await svar.arrayBuffer());
    const typ = svar.headers.get('content-type') || 'image/png';
    return `data:${typ};base64,${buf.toString('base64')}`;
  } catch (fel) {
    console.warn(`${vad} kunde inte hämtas, fortsätter utan:`, fel.message);
    return null;
  }
};

const logotypDataUri = await somDataUri(spec.logotypUrl, 'Loggan');
const portrattDataUri = await somDataUri(spec.portrattUrl, 'Porträttet');

/*
 * Bilderna laddas EN gång i sidan, inte per klipp. Med nio klipp blev det
 * annars nio identiska avkodningar av samma logga.
 */
await sidan.evaluate(async ({ logga, portratt }) => {
  const ladda = (kalla) => new Promise((klar) => {
    if (!kalla) return klar(null);
    const bild = new Image();
    bild.onload = () => klar(bild);
    bild.onerror = () => klar(null);
    bild.src = kalla;
  });
  window.__logga = await ladda(logga);
  window.__portratt = await ladda(portratt);
}, { logga: logotypDataUri, portratt: portrattDataUri });

const klipp = spec.klipp || [];
const filer = [];

for (let i = 0; i < klipp.length; i++) {
  await sidan.evaluate(({ k, index, antal, B, H, stil }) => {
    const duk = document.getElementById('duk');
    const ctx = duk.getContext('2d');

    window.SomeMotor.ritaOverlagg(ctx, k, {
      antalKlipp: antal,
      index: index,
      andel: 1,
      stil: stil,
      logotypBild: window.__logga,
      logotypProportion: window.__logga ? window.__logga.width / window.__logga.height : 5.1,
      portrattBild: window.__portratt
    }, B, H);
  }, { k: klipp[i], index: i, antal: klipp.length, B, H, stil: spec.stil || {} });

  const namn = `overlagg-${String(i).padStart(2, '0')}.png`;
  const sokvag = join(UT, namn);
  await sidan.locator('#duk').screenshot({ path: sokvag, omitBackground: true });
  filer.push(sokvag);
  console.log(`Överlägg ${i + 1}/${klipp.length} klart: ${namn}`);
}

await webblasare.close();
await writeFile(join(UT, 'overlagg.json'), JSON.stringify({ filer }, null, 2));
console.log(`Klart: ${filer.length} överlägg.`);
