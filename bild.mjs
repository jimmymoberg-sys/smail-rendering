/*
 * bild.mjs — ritar FÄRDIGA STILLBILDER (JPG) för Instagram/Facebook.
 *
 * Skillnaden mot overlagg.mjs: där ritas ett genomskinligt lager som ffmpeg
 * sedan lägger ovanpå ett foto. Här ritas fotot OCH överlägget i samma duk,
 * och resultatet är en färdig bild. Ingen ffmpeg, ingen video.
 *
 * ★ Samma motor ritar. motor/some-motor.js är EN sanning — en stillbild och
 *   en filmruta ser likadana ut därför att de går genom exakt samma kod.
 *
 * ★ EN körning kan producera MÅNGA bilder. Chromium startas en gång; att
 *   starta om den per bild kostar ~25 sekunder styck och är hela skälet till
 *   att specen tar en lista i stället för en bild.
 *
 * ★ CORS finns bara i webbläsaren. Node hämtar fotot fritt från
 *   mp1.skm.quedro.com och matar in det som data-URI. Sätt ALDRIG
 *   crossOrigin='anonymous' — då vägrar bilden ladda helt.
 *
 * Anrop:  node bild.mjs <spec.json>
 */

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HAR = dirname(fileURLToPath(import.meta.url));
const UT = join(HAR, 'ut');

const specSokvag = process.argv[2] || join(HAR, 'spec.json');
const spec = JSON.parse(await readFile(specSokvag, 'utf8'));

const bilder = spec.bilder || [];
if (!bilder.length) {
  console.error('AVBROTT: specen innehåller inga bilder.');
  process.exit(2);
}

const motorKod = await readFile(join(HAR, 'motor', 'some-motor.js'), 'utf8');

// Måtten kommer från MOTORN, inte härifrån. Redigeraren räknar på samma sätt.
const { SomeMotor } = await import('./motor/some-motor.js').then(() => ({ SomeMotor: globalThis.SomeMotor }));
const matt = SomeMotor.matt(spec.format || '4:5');
const B = spec.bredd || matt.bredd;
const H = spec.hojd || matt.hojd;
const kvalitet = Math.min(100, Math.max(1, Number(spec.kvalitet || 92)));

await mkdir(UT, { recursive: true });

const sida = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;background:#000}
  canvas{display:block}
</style>
</head><body>
<canvas id="duk" width="${B}" height="${H}"></canvas>
<script>${motorKod}</script>
</body></html>`;

const webblasare = await chromium.launch({ args: ['--force-color-profile=srgb'] });
const kontext = await webblasare.newContext({ viewport: { width: B, height: H }, deviceScaleFactor: 1 });
const sidan = await kontext.newPage();
await sidan.setContent(sida, { waitUntil: 'networkidle' });

/*
 * ★★ Samma typsnittsspärr som i overlagg.mjs, och av samma skäl: canvas
 * triggar INTE nedladdning av webbtypsnitt. Utan document.fonts.load() på
 * varje snitt OCH vikt ritas allt i Arial utan ett enda felmeddelande.
 * Hellre avbrott än en bild som publiceras i fel typsnitt.
 */
const typsnittOk = await sidan.evaluate(async (stil) => {
  const begar = window.SomeMotor.typsnittSomBehovs(stil);
  await Promise.all(begar.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  return begar.every((f) => document.fonts.check(f));
}, spec.stil || {});

if (!typsnittOk) {
  await webblasare.close();
  console.error('AVBROTT: Jost och/eller Inter laddade inte. Ritar hellre inget alls än i Arial.');
  process.exit(2);
}

const somDataUri = async (url, vad) => {
  if (!url) return null;
  try {
    const svar = await fetch(url);
    if (!svar.ok) throw new Error('HTTP ' + svar.status);
    const buf = Buffer.from(await svar.arrayBuffer());
    const typ = svar.headers.get('content-type') || 'image/jpeg';
    return `data:${typ};base64,${buf.toString('base64')}`;
  } catch (fel) {
    console.warn(`${vad} kunde inte hämtas, fortsätter utan:`, fel.message);
    return null;
  }
};

const logotypDataUri = await somDataUri(spec.logotypUrl, 'Loggan');
const portrattDataUri = await somDataUri(spec.portrattUrl, 'Porträttet');

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

const gjorda = [];

for (let i = 0; i < bilder.length; i++) {
  const b = bilder[i];
  const fotoDataUri = await somDataUri(b.fotoUrl, `Fotot till bild ${i + 1}`);

  const ritadesMedFoto = await sidan.evaluate(async ({ k, foto, B, H, stil }) => {
    const ladda = (kalla) => new Promise((klar) => {
      if (!kalla) return klar(null);
      const bild = new Image();
      bild.onload = () => klar(bild);
      bild.onerror = () => klar(null);
      bild.src = kalla;
    });
    const fotobild = await ladda(foto);

    const duk = document.getElementById('duk');
    const ctx = duk.getContext('2d');

    window.SomeMotor.ritaStillbild(ctx, fotobild, k, {
      antalKlipp: 1,
      index: 0,
      andel: 1,
      stil: stil,
      logotypBild: window.__logga,
      logotypProportion: window.__logga ? window.__logga.width / window.__logga.height : 5.1,
      portrattBild: window.__portratt
    }, B, H);

    return !!fotobild;
  }, { k: b, foto: fotoDataUri, B, H, stil: spec.stil || {} });

  if (!ritadesMedFoto && !SomeMotor.arKort(b.roll)) {
    // Inte ett avbrott: en bild utan foto blir mörk men läsbar, och en tom
    // ruta i en veckoserie ska inte fälla de andra sju.
    console.warn(`Bild ${i + 1}: fotot kunde inte ritas, bilden blir mörk.`);
  }

  const namn = b.filnamn || `bild-${String(i).padStart(2, '0')}.jpg`;
  const sokvag = join(UT, namn);
  await sidan.locator('#duk').screenshot({ path: sokvag, type: 'jpeg', quality: kvalitet });
  gjorda.push({ filnamn: namn, hadeFoto: ritadesMedFoto });
  console.log(`Bild ${i + 1}/${bilder.length} klar: ${namn} (${B}x${H})`);
}

await webblasare.close();
await writeFile(join(UT, 'bilder.json'), JSON.stringify({ format: spec.format || '4:5', bredd: B, hojd: H, bilder: gjorda }, null, 2));
console.log(`Klart: ${gjorda.length} bild(er), ${B}x${H}, kvalitet ${kvalitet}.`);
