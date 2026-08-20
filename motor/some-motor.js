/*
 * some-motor.js — SMaiL SoMe, den DELADE ritmotorn.
 *
 * ★★ EN SANNING. Den här filen körs på TVÅ ställen:
 *    1. i webbläsaren, för förhandsvisningen i redigeraren
 *    2. i headless Chromium på GitHub Actions (overlagg.mjs)
 *
 * Bygg ALDRIG om typografin i ffmpeg drawtext.
 *
 * ★ ALLT UTSEENDE STYRS AV `stil` — som kommer från some_mall i databasen.
 *   Ska loggan bli större, en färg bytas eller en rubrik krympas görs det DÄR,
 *   aldrig här. Koden innehåller funktion, mallen innehåller uttryck.
 *
 * TVÅ SORTERS BILDRUTOR:
 *   A. ÖVERLÄGG över ett foto  → genomskinlig bakgrund, toning nertill.
 *   B. GRAFISKT KORT utan foto → heltäckande bakgrund (faktakort,
 *      budskapskort, maklarkort).
 *
 * PREMIUMHÅLLNINGEN, uttalad så att den inte tappas bort:
 *   generösa marginaler · hårlinjer aldrig kanter · spärrade versaler i mycket
 *   litet format · EN stor sak per bild · inga skuggor, inga toningar utom
 *   fotots eget mörker. Tomrum är det billigaste premiummedlet som finns.
 */

(function (global) {
  'use strict';

  /* ---------- standardstil (mallen skriver över) ---------- */

  var STANDARD = {
    farger: {
      rymd: '#0B1213', sandsten: '#E6DED3', kokos: '#FFFFFF',
      lera: '#99918A', puder: '#E9CFC1', aska: '#F5F5F5'
    },
    typsnitt: { display: 'Jost', brod: 'Inter' },
    rubrik:   { vikt: 300, storlek: 0.082, farg: '#FFFFFF', maxRader: 3 },
    underrad: { vikt: 400, storlek: 0.037, farg: '#E6DED3' },
    etikett:  { vikt: 500, storlek: 0.028, farg: '#E9CFC1', versaler: true, sparrning: 0.006 },
    toning:   { styrka: 1.0, start: 0.42 },
    ram:      { visa: true, marginal: 0.045, farg: 'rgba(230,222,211,0.38)' },
    fortskridning: { visa: true },
    logotyp:  { visa: true, hojd: 0.05, placering: 'nere-hoger' },
    kort:     { marginal: 0.10 }
  };

  function slaIhop(bas, over) {
    var ut = {}, n;
    for (n in bas) {
      if (!Object.prototype.hasOwnProperty.call(bas, n)) continue;
      if (bas[n] && typeof bas[n] === 'object' && !Array.isArray(bas[n])) {
        ut[n] = slaIhop(bas[n], (over && over[n]) || {});
      } else {
        ut[n] = (over && over[n] !== undefined) ? over[n] : bas[n];
      }
    }
    if (over) { for (n in over) { if (!(n in ut)) ut[n] = over[n]; } }
    return ut;
  }

  function klamp(x, min, max) { return x < min ? min : (x > max ? max : x); }

  /* ---------- typografiska grundverktyg ---------- */

  function satt(ctx, stil, familj, vikt, andel, W) {
    var f = (familj === 'display') ? stil.typsnitt.display : stil.typsnitt.brod;
    ctx.font = vikt + ' ' + Math.round(W * andel) + 'px ' + f + ', sans-serif';
  }

  function brytRader(ctx, text, maxBredd) {
    var ord = String(text || '').split(/\s+/), rader = [], rad = '', i, forsok;
    for (i = 0; i < ord.length; i++) {
      forsok = rad ? rad + ' ' + ord[i] : ord[i];
      if (ctx.measureText(forsok).width > maxBredd && rad) { rader.push(rad); rad = ord[i]; }
      else { rad = forsok; }
    }
    if (rad) rader.push(rad);
    return rader;
  }

  /*
   * Spärrade versaler, tecken för tecken.
   * Canvas saknar letter-spacing i flera motorer, och spärrningen är den
   * ENSKILT viktigaste detaljen för att en liten etikett ska läsa som tryck
   * och inte som webb. Görs den inte för hand finns den inte.
   */
  function ritaSparrat(ctx, text, x, y, sparr) {
    var t = String(text || ''), i, xk = x;
    for (i = 0; i < t.length; i++) {
      ctx.fillText(t[i], xk, y);
      xk += ctx.measureText(t[i]).width + sparr;
    }
  }

  function matSparrat(ctx, text, sparr) {
    var t = String(text || ''), i, b = 0;
    for (i = 0; i < t.length; i++) { b += ctx.measureText(t[i]).width + sparr; }
    return b > 0 ? b - sparr : 0;
  }

  /* Hårlinje. Aldrig tjockare än en pixel vid 1080 — det är hela poängen. */
  function harlinje(ctx, x1, y, x2, farg, W) {
    ctx.strokeStyle = farg || 'rgba(230,222,211,0.28)';
    ctx.lineWidth = Math.max(1, Math.round(W / 1080));
    ctx.beginPath();
    ctx.moveTo(x1, Math.round(y) + 0.5);
    ctx.lineTo(x2, Math.round(y) + 0.5);
    ctx.stroke();
  }

  /* Rubrik som KRYMPER hellre än bryter till för många rader. */
  function passaRubrik(ctx, stil, text, maxBredd, W, startAndel, maxRader) {
    var storlek = W * (startAndel || stil.rubrik.storlek);
    var tak = maxRader || stil.rubrik.maxRader || 3;
    var rader;
    for (;;) {
      ctx.font = stil.rubrik.vikt + ' ' + Math.round(storlek) + 'px ' + stil.typsnitt.display + ', sans-serif';
      rader = brytRader(ctx, text, maxBredd);
      if (rader.length <= tak || storlek <= W * 0.042) break;
      storlek = storlek * 0.93;
    }
    return { rader: rader, storlek: storlek, radhojd: storlek * 1.1 };
  }

  /* ---------- gemensamma dekorationer ---------- */

  function ritaToning(ctx, stil, W, H) {
    var s = (stil.toning.styrka === undefined) ? 1 : stil.toning.styrka;
    var g = ctx.createLinearGradient(0, H * (stil.toning.start || 0.42), 0, H);
    g.addColorStop(0, 'rgba(11,18,19,0)');
    g.addColorStop(0.55, 'rgba(11,18,19,' + (0.55 * s).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(11,18,19,' + (0.88 * s).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function ritaRam(ctx, stil, W, H, farg) {
    if (!stil.ram || !stil.ram.visa) return;
    var m = Math.round(W * (stil.ram.marginal || 0.045));
    ctx.strokeStyle = farg || stil.ram.farg;
    ctx.lineWidth = Math.max(1, Math.round(W / 1080));
    ctx.strokeRect(m + 0.5, m + 0.5, W - m * 2 - 1, H - m * 2 - 1);
  }

  function ritaFortskridning(ctx, stil, W, antal, index, andel) {
    if (!stil.fortskridning || !stil.fortskridning.visa) return;
    if (!antal || antal < 2) return;
    var m = Math.round(W * (stil.ram.marginal || 0.045));
    var y = Math.round(m + W * 0.028);
    var mellan = Math.round(W * 0.012);
    var bredd = (W - m * 2 - mellan * (antal - 1)) / antal;
    var hojd = Math.max(2, Math.round(W / 180));
    for (var i = 0; i < antal; i++) {
      var x = m + i * (bredd + mellan);
      // Dämpad. Vid många klipp blir raden annars en rispig streckrad som
      // konkurrerar med typografin i stället för att bara ligga där.
      ctx.fillStyle = 'rgba(230,222,211,0.18)';
      ctx.fillRect(x, y, bredd, hojd);
      var fyll = (i < index) ? 1 : (i === index ? klamp(andel === undefined ? 1 : andel, 0, 1) : 0);
      if (fyll > 0) {
        ctx.fillStyle = 'rgba(230,222,211,0.72)';
        ctx.fillRect(x, y, bredd * fyll, hojd);
      }
    }
  }

  function ritaLogga(ctx, stil, spec, W, H, motMorkt) {
    if (!stil.logotyp || !stil.logotyp.visa || !spec.logotypBild) return;
    var m = Math.round(W * (stil.ram.marginal || 0.045)) + Math.round(W * 0.03);
    var lh = Math.round(W * (stil.logotyp.hojd || 0.05));
    var lb = lh * (spec.logotypProportion || 5.1);
    var x = (stil.logotyp.placering === 'nere-vanster') ? m : (W - m - lb);
    var y = H - m - lh;
    ctx.save();
    if (!motMorkt) ctx.globalAlpha = 0.9;
    ctx.drawImage(spec.logotypBild, x, y, lb, lh);
    ctx.restore();
  }

  /* ---------- A. överlägg över foto ---------- */

  function ritaFotooverlagg(ctx, klipp, spec, stil, W, H) {
    var m = Math.round(W * (stil.ram.marginal || 0.045));
    var x = m + Math.round(W * 0.03);
    var inner = W - x * 2;

    ritaToning(ctx, stil, W, H);
    ritaRam(ctx, stil, W, H);
    ritaFortskridning(ctx, stil, W, spec.antalKlipp, spec.index, spec.andel);

    // Byggs nerifrån och upp, så att en lång rubrik växer uppåt i stället för
    // att tryckas ut ur bild.
    var y = H - Math.round(H * 0.11);
    var i, j;

    if (klipp.underrad) {
      satt(ctx, stil, 'brod', stil.underrad.vikt, stil.underrad.storlek, W);
      ctx.fillStyle = stil.underrad.farg;
      var ur = brytRader(ctx, klipp.underrad, inner);
      for (i = ur.length - 1; i >= 0; i--) {
        ctx.fillText(ur[i], x, y);
        y -= Math.round(W * 0.052);
      }
      y -= Math.round(W * 0.018);
    }

    if (klipp.rubrik) {
      var r = passaRubrik(ctx, stil, klipp.rubrik, inner, W);
      ctx.fillStyle = stil.rubrik.farg;
      for (j = r.rader.length - 1; j >= 0; j--) {
        ctx.fillText(r.rader[j], x, y);
        y -= Math.round(r.radhojd);
      }
      y -= Math.round(W * 0.012);
    }

    if (klipp.etikett) {
      satt(ctx, stil, 'display', stil.etikett.vikt, stil.etikett.storlek, W);
      ctx.fillStyle = stil.etikett.farg;
      var e = stil.etikett.versaler ? String(klipp.etikett).toUpperCase() : String(klipp.etikett);
      ritaSparrat(ctx, e, x, y, Math.round(W * stil.etikett.sparrning));
    }

    ritaLogga(ctx, stil, spec, W, H, true);
  }

  /* ---------- B. grafiska kort ---------- */

  /*
   * Gemensam rytm för alla tre kort — den gör att de känns som en familj:
   *
   *     ögonbryn (spärrade versaler, mycket litet)
   *     PÅSTÅENDE (stort, lätt, generöst)
   *     ──────── hårlinje
   *     detalj (litet, dämpat)
   *
   * Kortens marginal är dubbelt så generös som fotoöverläggets, med flit.
   */

  function kortbakgrund(ctx, stil, W, H, mork) {
    ctx.fillStyle = mork ? stil.farger.rymd : stil.farger.sandsten;
    ctx.fillRect(0, 0, W, H);
    // Knappt märkbar vinjett så att ytan inte läser som en platt färgplatta.
    var g = ctx.createRadialGradient(W * 0.5, H * 0.42, W * 0.10, W * 0.5, H * 0.5, H * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, mork ? 'rgba(0,0,0,0.32)' : 'rgba(11,18,19,0.06)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function ogonbryn(ctx, stil, text, x, y, W, farg) {
    if (!text) return;
    satt(ctx, stil, 'display', 500, 0.024, W);
    ctx.fillStyle = farg;
    ritaSparrat(ctx, String(text).toUpperCase(), x, y, Math.round(W * 0.008));
  }

  function fargpar(stil, mork) {
    return {
      text: mork ? stil.farger.kokos : stil.farger.rymd,
      dampad: mork ? stil.farger.lera : 'rgba(11,18,19,0.55)',
      linje: mork ? 'rgba(230,222,211,0.22)' : 'rgba(11,18,19,0.18)',
      finlinje: mork ? 'rgba(230,222,211,0.12)' : 'rgba(11,18,19,0.10)',
      accent: mork ? stil.farger.puder : 'rgba(11,18,19,0.55)'
    };
  }

  function ritaFaktakort(ctx, klipp, spec, stil, W, H) {
    var mork = klipp.bakgrund !== 'ljus';
    var f = fargpar(stil, mork);

    kortbakgrund(ctx, stil, W, H, mork);
    ritaRam(ctx, stil, W, H, f.linje);
    ritaFortskridning(ctx, stil, W, spec.antalKlipp, spec.index, spec.andel);

    var m = Math.round(W * (stil.kort.marginal || 0.10));
    var y = Math.round(H * 0.28);
    var i;

    ogonbryn(ctx, stil, klipp.etikett || 'Fakta', m, y, W, f.accent);

    // Hjältesiffran — EN stor sak per bild, resten är stöd.
    if (klipp.hjalte && klipp.hjalte.varde !== undefined) {
      y += Math.round(H * 0.085);
      ctx.font = '300 ' + Math.round(W * 0.20) + 'px ' + stil.typsnitt.display + ', sans-serif';
      ctx.fillStyle = f.text;
      var siffra = String(klipp.hjalte.varde);
      ctx.fillText(siffra, m, y);
      if (klipp.hjalte.enhet) {
        var bredd = ctx.measureText(siffra).width;
        satt(ctx, stil, 'display', 300, 0.055, W);
        ctx.fillStyle = f.dampad;
        ctx.fillText(klipp.hjalte.enhet, m + bredd + Math.round(W * 0.022), y);
      }
      if (klipp.hjalte.etikett) {
        y += Math.round(H * 0.030);
        satt(ctx, stil, 'display', 500, 0.022, W);
        ctx.fillStyle = f.dampad;
        ritaSparrat(ctx, String(klipp.hjalte.etikett).toUpperCase(), m, y, Math.round(W * 0.007));
      }
      y += Math.round(H * 0.042);
    } else {
      y += Math.round(H * 0.050);
    }

    harlinje(ctx, m, y, W - m, f.linje, W);
    y += Math.round(H * 0.048);

    // Faktarader: etikett vänster i spärrade versaler, värde högerställt.
    // Högerställningen ger den lugna kataloglayouten — kolumnen blir en linje.
    var rader = (klipp.fakta || []).slice(0, 6);
    for (i = 0; i < rader.length; i++) {
      satt(ctx, stil, 'display', 500, 0.022, W);
      ctx.fillStyle = f.dampad;
      ritaSparrat(ctx, String(rader[i].etikett || '').toUpperCase(), m, y, Math.round(W * 0.007));

      satt(ctx, stil, 'display', 300, 0.046, W);
      ctx.fillStyle = f.text;
      var v = String(rader[i].varde === undefined ? '' : rader[i].varde);
      ctx.fillText(v, W - m - ctx.measureText(v).width, y + Math.round(W * 0.007));

      y += Math.round(H * 0.040);
      if (i < rader.length - 1) {
        harlinje(ctx, m, y - Math.round(H * 0.015), W - m, f.finlinje, W);
      }
    }

    ritaLogga(ctx, stil, spec, W, H, mork);
  }

  function ritaBudskapskort(ctx, klipp, spec, stil, W, H) {
    // ★ Budskapskortet går LJUST med flit. Mitt i en följd mörka fotoklipp blir
    // den ljusa ytan en andning — och det är där blicken fastnar.
    var mork = klipp.bakgrund === 'mork';
    var f = fargpar(stil, mork);

    kortbakgrund(ctx, stil, W, H, mork);
    ritaRam(ctx, stil, W, H, f.linje);
    ritaFortskridning(ctx, stil, W, spec.antalKlipp, spec.index, spec.andel);

    var m = Math.round(W * (stil.kort.marginal || 0.10));
    var inner = W - m * 2;
    var i;

    // Mät hela blocket först och centrera det optiskt, en aning ovanför mitten.
    var r = passaRubrik(ctx, stil, klipp.rubrik || '', inner, W, 0.115, 4);
    var blockH = r.rader.length * r.radhojd;
    if (klipp.etikett) blockH += Math.round(H * 0.055);
    if (klipp.underrad) blockH += Math.round(H * 0.075);

    var y = Math.round(H * 0.46 - blockH / 2);

    if (klipp.etikett) {
      ogonbryn(ctx, stil, klipp.etikett, m, y, W, f.accent);
      y += Math.round(H * 0.055);
    }

    ctx.font = '300 ' + Math.round(r.storlek) + 'px ' + stil.typsnitt.display + ', sans-serif';
    ctx.fillStyle = f.text;
    for (i = 0; i < r.rader.length; i++) {
      y += Math.round(r.radhojd);
      ctx.fillText(r.rader[i], m, y);
    }

    if (klipp.underrad) {
      y += Math.round(H * 0.030);
      harlinje(ctx, m, y, m + Math.round(W * 0.16), f.linje, W);
      y += Math.round(H * 0.045);
      satt(ctx, stil, 'display', 400, 0.042, W);
      ctx.fillStyle = f.dampad;
      ctx.fillText(klipp.underrad, m, y);
    }

    ritaLogga(ctx, stil, spec, W, H, mork);
  }

  function ritaMaklarkort(ctx, klipp, spec, stil, W, H) {
    var mork = klipp.bakgrund !== 'ljus';
    var f = fargpar(stil, mork);

    kortbakgrund(ctx, stil, W, H, mork);
    ritaRam(ctx, stil, W, H, f.linje);
    ritaFortskridning(ctx, stil, W, spec.antalKlipp, spec.index, spec.andel);

    var y = Math.round(H * 0.28);

    // Porträtt i cirkel mot Aska — profilens egen regel för porträtt.
    if (spec.portrattBild && spec.portrattBild.naturalWidth) {
      var d = Math.round(W * 0.34);
      var cx = Math.round(W / 2);
      var cy = y + Math.round(d / 2);
      var pb = spec.portrattBild;
      var sida = Math.min(pb.naturalWidth, pb.naturalHeight);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
      ctx.fillStyle = stil.farger.aska || '#F5F5F5';
      ctx.fill();
      ctx.clip();
      ctx.drawImage(pb,
        (pb.naturalWidth - sida) / 2, (pb.naturalHeight - sida) / 2, sida, sida,
        cx - d / 2, cy - d / 2, d, d);
      ctx.restore();

      // Hårfin ring, aldrig en tjock kant.
      ctx.strokeStyle = mork ? 'rgba(230,222,211,0.35)' : 'rgba(11,18,19,0.22)';
      ctx.lineWidth = Math.max(1, Math.round(W / 1080));
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 + 0.5, 0, Math.PI * 2);
      ctx.stroke();

      y = cy + d / 2 + Math.round(H * 0.058);
    } else if (klipp.rubrik) {
      /*
       * Saknas porträtt ritas ett MONOGRAM i stället — initialerna i en hårfin
       * cirkel. Utan något ankare uppe tappar kortet sin tyngdpunkt och texten
       * flyter. Reserven gör att kortet fungerar redan innan porträtt finns
       * i databasen (profiles har ingen bildkolumn i dag).
       */
      var dm = Math.round(W * 0.30);
      var mx = Math.round(W / 2);
      var my = y + Math.round(dm / 2);

      ctx.strokeStyle = mork ? 'rgba(230,222,211,0.30)' : 'rgba(11,18,19,0.20)';
      ctx.lineWidth = Math.max(1, Math.round(W / 1080));
      ctx.beginPath();
      ctx.arc(mx, my, dm / 2, 0, Math.PI * 2);
      ctx.stroke();

      var delar = String(klipp.rubrik).trim().split(/\s+/);
      var initialer = (delar[0] ? delar[0][0] : '') +
        (delar.length > 1 ? delar[delar.length - 1][0] : '');

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      satt(ctx, stil, 'display', 300, 0.105, W);
      ctx.fillStyle = f.text;
      ctx.fillText(initialer.toUpperCase(), mx, my + Math.round(W * 0.004));
      ctx.restore();
      ctx.textBaseline = 'alphabetic';

      y = my + dm / 2 + Math.round(H * 0.058);
    } else {
      y = Math.round(H * 0.40);
    }

    // Kontaktuppgifter läser bäst symmetriskt — här och bara här centreras allt.
    if (klipp.etikett) {
      satt(ctx, stil, 'display', 500, 0.024, W);
      ctx.fillStyle = f.accent;
      var e = String(klipp.etikett).toUpperCase();
      var sp = Math.round(W * 0.008);
      ritaSparrat(ctx, e, (W - matSparrat(ctx, e, sp)) / 2, y, sp);
      y += Math.round(H * 0.050);
    }

    ctx.save();
    ctx.textAlign = 'center';

    if (klipp.rubrik) {
      satt(ctx, stil, 'display', 300, 0.072, W);
      ctx.fillStyle = f.text;
      ctx.fillText(klipp.rubrik, W / 2, y);
      y += Math.round(H * 0.028);
    }

    harlinje(ctx, W / 2 - Math.round(W * 0.08), y, W / 2 + Math.round(W * 0.08), f.linje, W);
    y += Math.round(H * 0.045);

    if (klipp.underrad) {
      satt(ctx, stil, 'brod', 400, 0.038, W);
      ctx.fillStyle = f.dampad;
      ctx.fillText(klipp.underrad, W / 2, y);
      y += Math.round(H * 0.046);
    }

    if (klipp.rad3) {
      satt(ctx, stil, 'brod', 400, 0.034, W);
      ctx.fillStyle = f.dampad;
      ctx.fillText(klipp.rad3, W / 2, y);
    }

    ctx.restore();
    ritaLogga(ctx, stil, spec, W, H, mork);
  }

  /* ---------- ingång ---------- */

  var KORT = {
    faktakort: ritaFaktakort,
    budskapskort: ritaBudskapskort,
    maklarkort: ritaMaklarkort
  };

  /*
   * Ritar EN bildruta.
   *
   * ctx   — 2D-kontext, redan tömd
   * klipp — { roll, rubrik, underrad, rad3, etikett, fakta, hjalte, bakgrund }
   * spec  — { antalKlipp, index, andel, stil, logotypBild, logotypProportion,
   *           portrattBild }
   * W, H  — målytans mått (1080x1920 för 9:16)
   *
   * Är rollen ett kort ritas en HELTÄCKANDE bakgrund. Annars ritas ett
   * genomskinligt överlägg avsett att läggas ovanpå ett foto.
   */
  function ritaOverlagg(ctx, klipp, spec, W, H) {
    klipp = klipp || {};
    spec = spec || {};
    var stil = slaIhop(STANDARD, spec.stil || {});

    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    var kort = KORT[klipp.roll];
    if (kort) { kort(ctx, klipp, spec, stil, W, H); return; }
    ritaFotooverlagg(ctx, klipp, spec, stil, W, H);
  }

  /* Sant om rollen ritas utan foto — renderaren behöver veta det för att
   * hoppa över fotohämtning och Ken Burns för just det klippet. */
  function arKort(roll) { return !!KORT[roll]; }

  /*
   * Vilka snitt och vikter som MÅSTE vara laddade innan något ritas.
   * ★ Canvas triggar inte nedladdning av webbtypsnitt — varje post här måste
   *   begäras med document.fonts.load() först, annars ritas allt i Arial utan
   *   att något felmeddelande visas. Se overlagg.mjs.
   */
  function typsnittSomBehovs(stil) {
    var s = slaIhop(STANDARD, stil || {});
    return [
      '300 200px ' + s.typsnitt.display,
      '400 40px ' + s.typsnitt.display,
      '500 30px ' + s.typsnitt.display,
      '400 40px ' + s.typsnitt.brod
    ];
  }

  var API = {
    ritaOverlagg: ritaOverlagg,
    arKort: arKort,
    typsnittSomBehovs: typsnittSomBehovs,
    brytRader: brytRader,
    STANDARD: STANDARD
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
  global.SomeMotor = API;
})(typeof window !== 'undefined' ? window : globalThis);
