/*
 * rendera.mjs — ffmpeg-halvan. Foto + Ken Burns + överlägg → färdig MP4.
 *
 * ✔ DEN HÄR HALVAN ÄR MÄTT OCH TESTAD (20 aug 2026): 3 klipp, 1080x1920,
 *   h264/yuv420p, 30 fps, 7,8 s på ~34 s körtid. Faststart bekräftad.
 *
 * ★★ TVÅ FÄLLOR SOM ÄR BEVISADE GENOM MÄTNING — RÖR DEM INTE UTAN ATT MÄTA OM:
 *
 * 1. `-loop 1` startar om zoompan-cykeln för VARJE insignalsruta, vilket ger
 *    en stakande zoom. Fotot ska matas in som EN enda ruta; det är zoompan
 *    som expanderar den till d= rutor. Därför finns inget -loop nedan.
 *
 * 2. zoompan räknar beskärningsrutan i HELTALSPIXLAR. Vid långsam panorering
 *    hoppar bilden. Motmedlet är att skala upp med SUPER före zoompan.
 *    Uppmätt hopp: SUPER 1,5 → 0,70 px · 2 → 0,49 · 3 → 0,33 · 4 → 0,36.
 *    Kurvan planar ut vid 3. SÄNK INTE utan att titta på resultatet.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const kor = promisify(execFile);
const HAR = dirname(fileURLToPath(import.meta.url));
const UT = join(HAR, 'ut');
const TMP = join(HAR, 'tmp');

const SUPER = 3;       // se fälla 2 ovan
const FPS = 30;
const OVERGANG = 0.5;  // sekunder xfade mellan klipp

const specSokvag = process.argv[2] || join(HAR, 'spec.json');
const spec = JSON.parse(await readFile(specSokvag, 'utf8'));

const B = spec.bredd || 1080;
const H = spec.hojd || 1920;
const klipp = spec.klipp || [];

if (!klipp.length) {
  console.error('AVBROTT: spec innehåller inga klipp.');
  process.exit(2);
}

await mkdir(TMP, { recursive: true });
await mkdir(UT, { recursive: true });

const ffmpeg = async (args) => {
  const { stderr } = await kor('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: 1024 * 1024 * 64
  });
  if (stderr && stderr.trim()) console.log(stderr.trim());
};

/*
 * ★ Fotona hämtas i ?width=3000, inte 1500.
 * 1500 ger bara ca 1000 px höjd, vilket måste skalas UPP till 1920 — exakt det
 * som gjorde de första tryckfilerna mjuka. Servern hämtar bilderna utan CORS-
 * hinder; CORS finns bara i webbläsaren.
 */
const bredda = (url) => {
  if (!url) return url;
  return url.includes('?') ? url.replace(/([?&])width=\d+/, '$1width=3000') : url + '?width=3000';
};

const hamtaFoto = async (url, index) => {
  const svar = await fetch(bredda(url));
  if (!svar.ok) throw new Error(`Kunde inte hämta foto ${index}: HTTP ${svar.status}`);
  const sokvag = join(TMP, `foto-${String(index).padStart(2, '0')}.jpg`);
  await writeFile(sokvag, Buffer.from(await svar.arrayBuffer()));
  return sokvag;
};

const delar = [];

for (let i = 0; i < klipp.length; i++) {
  const k = klipp[i];
  const langd = k.sekunder || 3;
  const rutor = Math.round(langd * FPS);

  const foto = await hamtaFoto(k.fotoUrl, i);
  const overlagg = join(UT, `overlagg-${String(i).padStart(2, '0')}.png`);

  const zoomFran = k.zoomFran === undefined ? 1.0 : k.zoomFran;
  const zoomTill = k.zoomTill === undefined ? 1.12 : k.zoomTill;
  // fx/fy är blickpunkten, 0..1. 0.5 = mitten. Utan x/y-uttrycken nedan
  // zoomar ffmpeg mot övre vänstra hörnet i stället för mot motivet.
  const fx = k.fx === undefined ? 0.5 : k.fx;
  const fy = k.fy === undefined ? 0.5 : k.fy;

  const del = join(TMP, `del-${String(i).padStart(2, '0')}.mp4`);

  // Filtergrafen byggs som tre kedjor separerade med semikolon. Kommatecken
  // binder ihop filter INOM en kedja, semikolon skiljer kedjor åt — blandas de
  // ihop blir felet ett kryptiskt "Invalid argument" långt senare.
  const kedjaBakgrund =
    `[0:v]scale=${B * SUPER}:${H * SUPER}:force_original_aspect_ratio=increase,`
    + `crop=${B * SUPER}:${H * SUPER},`
    // Linjär zoom på 'on' (utrutans nummer) — inte ackumulerande, som driver iväg.
    + `zoompan=z='${zoomFran}+(${zoomTill}-${zoomFran})*on/${rutor}'`
    + `:x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}'`
    + `:d=${rutor}:s=${B}x${H}:fps=${FPS}[bg]`;

  // Överlägget tonas in mjukt så att texten inte klipper in.
  const kedjaOverlagg = `[1:v]format=rgba,fade=in:st=0:d=0.35:alpha=1[ov]`;

  const kedjaIhop = `[bg][ov]overlay=0:0:format=auto,format=yuv420p[v]`;

  const filter = [kedjaBakgrund, kedjaOverlagg, kedjaIhop].join(';');

  await ffmpeg([
    '-i', foto,          // ★ INGET -loop 1 — se fälla 1
    '-i', overlagg,
    '-filter_complex', filter,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-t', String(langd),
    del
  ]);

  delar.push(del);
  console.log(`Klipp ${i + 1}/${klipp.length} renderat (${langd}s).`);
}

// ★ Filnamnet kan komma från TVÅ håll: arbetsflödets inputs.filnamn (som
// efterföljande steg och SFTP-uppladdningen använder) och spec.filnamn.
// ARBETSFLÖDETS namn vinner — annars renderas filmen under ett namn och
// letas upp under ett annat, och felet blir "No such file or directory"
// i ett steg som ser helt orelaterat ut.
const utFilnamn = process.argv[3] || spec.filnamn || 'reel.mp4';
const slutfil = join(UT, utFilnamn);

if (delar.length === 1) {
  await ffmpeg(['-i', delar[0], '-c', 'copy', '-movflags', '+faststart', slutfil]);
} else {
  // xfade kedjas parvis. Offset är summan av föregående längder minus
  // de övergångar som redan ätits upp.
  const inMatningar = [];
  delar.forEach((d) => inMatningar.push('-i', d));

  let filter = '';
  let forra = '[0:v]';
  let tid = 0;

  for (let i = 1; i < delar.length; i++) {
    const langdForra = i === 1 ? (klipp[0].sekunder || 3) : (klipp[i - 1].sekunder || 3);
    tid += langdForra - OVERGANG;
    const ut = i === delar.length - 1 ? '[v]' : `[x${i}]`;
    const overgang = klipp[i].overgang || 'fade';
    filter += `${forra}[${i}:v]xfade=transition=${overgang}:duration=${OVERGANG}:offset=${tid.toFixed(3)}${ut};`;
    forra = ut;
  }

  filter = filter.replace(/;$/, '');

  await ffmpeg([
    ...inMatningar,
    '-filter_complex', filter,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',   // moov FÖRE mdat — annars spelar inte webben upp förrän allt laddat
    slutfil
  ]);
}

await rm(TMP, { recursive: true, force: true });
console.log(`Klart: ${slutfil}`);
