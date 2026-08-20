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
const typsnittOk = await sidan.evaluate(async () => {
  /*
   * ★★ CANVAS TRIGGAR INTE NEDLADDNING AV WEBBTYPSNITT.
   * Ett snitt som bara är deklarerat i CSS men aldrig används av ett DOM-element
   * hämtas aldrig hem. document.fonts.ready resolvar direkt (det finns inget
   * pågående att vänta på) och check() svarar false hur länge man än väntar.
   * ctx.font = '... Jost' räcker inte heller — canvas är inte DOM.
   * Varje snitt och vikt måste begäras EXPLICIT med document.fonts.load().
   */
  const begar = ['300 80px Jost', '500 30px Jost', '400 40px Inter'];
  await Promise.all(begar.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  return begar.every((f) => document.fonts.check(f));
});

if (!typsnittOk) {
  await webblasare.close();
  console.error('AVBROTT: Jost och/eller Inter laddade inte. Renderar hellre inget alls än i Arial.');
  process.exit(2);
}

// Loggan hämtas som data-URI så att Chromium slipper ett nätverksanrop mitt i ritningen.
let logotypDataUri = null;
if (spec.logotypUrl) {
  try {
    const svar = await fetch(spec.logotypUrl);
    if (svar.ok) {
      const buf = Buffer.from(await svar.arrayBuffer());
      const typ = svar.headers.get('content-type') || 'image/png';
      logotypDataUri = `data:${typ};base64,${buf.toString('base64')}`;
    }
  } catch (fel) {
    console.warn('Loggan kunde inte hämtas, fortsätter utan:', fel.message);
  }
}

const klipp = spec.klipp || [];
const filer = [];

for (let i = 0; i < klipp.length; i++) {
  await sidan.evaluate(async ({ k, index, antal, B, H, logga }) => {
    const duk = document.getElementById('duk');
    const ctx = duk.getContext('2d');

    let logotypBild = null;
    if (logga) {
      logotypBild = await new Promise((klar) => {
        const bild = new Image();
        bild.onload = () => klar(bild);
        bild.onerror = () => klar(null);
        bild.src = logga;
      });
    }

    window.SomeMotor.ritaOverlagg(ctx, k, {
      antalKlipp: antal,
      index: index,
      andel: 1,
      logotypBild: logotypBild,
      logotypProportion: logotypBild ? logotypBild.width / logotypBild.height : 5.1
    }, B, H);
  }, { k: klipp[i], index: i, antal: klipp.length, B, H, logga: logotypDataUri });

  const namn = `overlagg-${String(i).padStart(2, '0')}.png`;
  const sokvag = join(UT, namn);
  await sidan.locator('#duk').screenshot({ path: sokvag, omitBackground: true });
  filer.push(sokvag);
  console.log(`Överlägg ${i + 1}/${klipp.length} klart: ${namn}`);
}

await webblasare.close();
await writeFile(join(UT, 'overlagg.json'), JSON.stringify({ filer }, null, 2));
console.log(`Klart: ${filer.length} överlägg.`);
