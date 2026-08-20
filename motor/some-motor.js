/*
 * some-motor.js — SMaiL SoMe, den DELADE ritmotorn.
 *
 * ★★ EN SANNING. Den här filen körs på TVÅ ställen:
 *    1. i webbläsaren, för förhandsvisningen i redigeraren
 *    2. i headless Chromium på GitHub Actions (overlagg.mjs), för de PNG:er
 *       som ffmpeg sedan lägger ovanpå fotot
 *
 * Bygg ALDRIG om typografin i ffmpeg drawtext. Ändras något här ändras det
 * på båda ställena samtidigt — det är hela poängen med konstruktionen.
 *
 * Motorn ritar BARA överlägget (text, toning, ram, logga, fortskridningsrad).
 * Fotot och Ken Burns-rörelsen ligger under och görs av ffmpeg.
 * Bakgrunden ska därför alltid vara genomskinlig.
 */

(function (global) {
  'use strict';

  // Paletten ur SkandiaMäklarnas grafiska profil.
  var FARG = {
    rymd: '#0B1213',
    sandsten: '#E6DED3',
    kokos: '#FFFFFF',
    lera: '#99918A',
    puder: '#E9CFC1'
  };

  // Jost står in för Neutra Premium, som inte finns som webbfont.
  var DISPLAY = 'Jost';
  var BROD = 'Inter';

  function klamp(x, min, max) {
    return x < min ? min : (x > max ? max : x);
  }

  /* Radbryter text på riktigt, mot en given bredd. */
  function brytRader(ctx, text, maxBredd) {
    var ord = String(text || '').split(/\s+/);
    var rader = [];
    var rad = '';
    for (var i = 0; i < ord.length; i++) {
      var forsok = rad ? rad + ' ' + ord[i] : ord[i];
      if (ctx.measureText(forsok).width > maxBredd && rad) {
        rader.push(rad);
        rad = ord[i];
      } else {
        rad = forsok;
      }
    }
    if (rad) rader.push(rad);
    return rader;
  }

  /* Mörk toning nertill så att texten alltid är läsbar mot vilket foto som helst. */
  function ritaToning(ctx, W, H, styrka) {
    var g = ctx.createLinearGradient(0, H * 0.42, 0, H);
    g.addColorStop(0, 'rgba(11,18,19,0)');
    g.addColorStop(0.55, 'rgba(11,18,19,' + (0.55 * styrka).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(11,18,19,' + (0.88 * styrka).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* Tunn hårlinjeram — den diskreta premiummarkören. */
  function ritaRam(ctx, W, H) {
    var m = Math.round(W * 0.045);
    ctx.strokeStyle = 'rgba(230,222,211,0.38)';
    ctx.lineWidth = Math.max(1, Math.round(W / 540));
    ctx.strokeRect(m + 0.5, m + 0.5, W - m * 2 - 1, H - m * 2 - 1);
  }

  /* Storiesliknande fortskridningsrad högst upp. */
  function ritaFortskridning(ctx, W, H, antal, index, andel) {
    if (!antal || antal < 2) return;
    var m = Math.round(W * 0.045);
    var y = Math.round(m + W * 0.028);
    var mellanrum = Math.round(W * 0.012);
    var bredd = (W - m * 2 - mellanrum * (antal - 1)) / antal;
    var hojd = Math.max(2, Math.round(W / 180));
    for (var i = 0; i < antal; i++) {
      var x = m + i * (bredd + mellanrum);
      ctx.fillStyle = 'rgba(230,222,211,0.30)';
      ctx.fillRect(x, y, bredd, hojd);
      var fyllnad = i < index ? 1 : (i === index ? klamp(andel, 0, 1) : 0);
      if (fyllnad > 0) {
        ctx.fillStyle = FARG.sandsten;
        ctx.fillRect(x, y, bredd * fyllnad, hojd);
      }
    }
  }

  /*
   * Ritar ETT klipps överlägg.
   *
   * ctx    — 2D-kontext, redan tömd, genomskinlig bakgrund
   * klipp  — { rubrik, underrad, etikett, toning }
   * spec   — { antalKlipp, index, logotypBild, format }
   * W, H   — målytans mått i pixlar (1080x1920 för 9:16)
   */
  function ritaOverlagg(ctx, klipp, spec, W, H) {
    klipp = klipp || {};
    spec = spec || {};

    var m = Math.round(W * 0.045);
    var innerBredd = W - m * 2 - Math.round(W * 0.06);

    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    ritaToning(ctx, W, H, klipp.toning === undefined ? 1 : klipp.toning);
    ritaRam(ctx, W, H);
    ritaFortskridning(ctx, W, H, spec.antalKlipp, spec.index, spec.andel);

    // Bottenblocket byggs nerifrån och upp, så att en lång rubrik växer uppåt
    // i stället för att tryckas ut ur bild.
    var y = H - Math.round(H * 0.11);
    var x = m + Math.round(W * 0.03);

    if (klipp.underrad) {
      ctx.font = '400 ' + Math.round(W * 0.037) + 'px ' + BROD + ', sans-serif';
      ctx.fillStyle = FARG.sandsten;
      var underrader = brytRader(ctx, klipp.underrad, innerBredd);
      for (var i = underrader.length - 1; i >= 0; i--) {
        ctx.fillText(underrader[i], x, y);
        y -= Math.round(W * 0.052);
      }
      y -= Math.round(W * 0.018);
    }

    if (klipp.rubrik) {
      var storlek = Math.round(W * 0.082);
      ctx.font = '300 ' + storlek + 'px ' + DISPLAY + ', sans-serif';
      var rubrikrader = brytRader(ctx, klipp.rubrik, innerBredd);
      // Krymp hellre än att bryta till fyra rader.
      while (rubrikrader.length > 3 && storlek > W * 0.05) {
        storlek = Math.round(storlek * 0.92);
        ctx.font = '300 ' + storlek + 'px ' + DISPLAY + ', sans-serif';
        rubrikrader = brytRader(ctx, klipp.rubrik, innerBredd);
      }
      ctx.fillStyle = FARG.kokos;
      for (var j = rubrikrader.length - 1; j >= 0; j--) {
        ctx.fillText(rubrikrader[j], x, y);
        y -= Math.round(storlek * 1.12);
      }
      y -= Math.round(W * 0.014);
    }

    if (klipp.etikett) {
      ctx.font = '500 ' + Math.round(W * 0.028) + 'px ' + DISPLAY + ', sans-serif';
      ctx.fillStyle = FARG.puder;
      var etikett = String(klipp.etikett).toUpperCase();
      // Versalspärrning för hand — canvas har ingen letter-spacing.
      var sparr = Math.round(W * 0.006);
      var xk = x;
      for (var t = 0; t < etikett.length; t++) {
        ctx.fillText(etikett[t], xk, y);
        xk += ctx.measureText(etikett[t]).width + sparr;
      }
      y -= Math.round(W * 0.05);
    }

    // Loggan nere till höger, mot den mörkaste delen av toningen.
    if (spec.logotypBild) {
      var lh = Math.round(W * 0.05);
      var lb = lh * (spec.logotypProportion || 5.1);
      ctx.drawImage(spec.logotypBild, W - m - Math.round(W * 0.03) - lb, H - m - Math.round(W * 0.03) - lh, lb, lh);
    }
  }

  var API = {
    ritaOverlagg: ritaOverlagg,
    brytRader: brytRader,
    FARG: FARG,
    DISPLAY: DISPLAY,
    BROD: BROD
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  global.SomeMotor = API;
})(typeof window !== 'undefined' ? window : globalThis);
