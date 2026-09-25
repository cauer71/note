// Notes – App-Symbol und Startanimation (eine Quelle für Icons, Startbilder und die App)
// Läuft im Browser und in den Node-Skripten (scripts/icons.mjs, scripts/build.mjs).

export const APP_NAME = 'Notes';
export const BRAND = '#5856d6';
export const SPLASH_BG = '#5856d6';

// Handschrift-Schnörkel auf dem Blatt: Start (142,368), Ende = Stiftspitze (300,354)
const INK = [
  [142, 368, 156, 338, 172, 338, 176, 360],
  [176, 360, 180, 382, 186, 390, 198, 368],
  [198, 368, 210, 346, 222, 334, 234, 358],
  [234, 358, 240, 368, 248, 384, 264, 362],
  [264, 362, 280, 340, 286, 342, 300, 354],
];
const INK_D = 'M142 368' + INK.map((s) => ` C${s.slice(2).join(' ')}`).join('');
function bezierLength([x0, y0, x1, y1, x2, y2, x3, y3]) {
  let len = 0;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= 64; i++) {
    const t = i / 64;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    len += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return len;
}
const INK_LEN = Math.ceil(INK.reduce((s, seg) => s + bezierLength(seg), 0)) + 2;
const CHECK_D = 'M149 199 L156 206 L168 191';
const CHECK_LEN = 30;

// Bleistift, Spitze im Ursprung, Schaft entlang +x
const PENCIL = `
    <polygon points="0,0 58,-23 58,23" fill="#f6d3a1"/>
    <polygon points="0,0 20,-8 20,8" fill="#2c2c2e"/>
    <rect x="57" y="-23" width="142" height="46" fill="#ff9f0a"/>
    <rect x="57" y="-23" width="142" height="14" fill="#ffb340"/>
    <rect x="57" y="9" width="142" height="14" fill="#ee8400"/>
    <rect x="214" y="-23" width="40" height="46" rx="13" fill="#ff6482"/>
    <rect x="198" y="-23" width="24" height="46" fill="#d1d1d6"/>
    <rect x="205" y="-23" width="3" height="46" fill="#aeaeb2"/>
    <rect x="213" y="-23" width="3" height="46" fill="#aeaeb2"/>`;

// Die Zeichnung selbst (512er-Raster): Blatt mit Überschrift, erledigtem To-do, Zeilen, Handschrift und Stift.
// anim = true → Klassen für die Startanimation, Häkchen/Schrift/Stift starten unsichtbar (per CSS).
function artwork(id, anim) {
  const c = (name) => (anim ? ` class="${name}"` : '');
  return `
  <g filter="url(#${id}-sh)">
    <rect x="96" y="64" width="320" height="384" rx="54" fill="url(#${id}-page)"/>
  </g>
  <rect x="140" y="116" width="170" height="30" rx="15" fill="${BRAND}"/>
  <rect x="140" y="180" width="38" height="38" rx="12" fill="#fff" stroke="#c7c6f2" stroke-width="5"/>
  <rect${c('sp-box')} x="140" y="180" width="38" height="38" rx="12" fill="#34c759"/>
  <path${c('sp-check')} d="${CHECK_D}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${CHECK_LEN}" stroke-dashoffset="0"/>
  <rect x="196" y="190" width="146" height="18" rx="9" fill="#c7c6f2"/>
  <rect x="140" y="248" width="202" height="18" rx="9" fill="#c7c6f2"/>
  <rect x="140" y="290" width="168" height="18" rx="9" fill="#c7c6f2"/>
  <path${c('sp-ink')} d="${INK_D}" fill="none" stroke="${BRAND}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${INK_LEN}" stroke-dashoffset="0"/>
  <g${c('sp-pen')}>
    <g transform="translate(300 354) rotate(-52)" filter="url(#${id}-psh)">${PENCIL}
    </g>
  </g>`;
}

function defs(id, withBg) {
  return `<defs>
    ${
      withBg
        ? `<linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7d7aff"/>
      <stop offset=".55" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="#a24fe0"/>
    </linearGradient>
    <linearGradient id="${id}-sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
      <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>`
        : ''
    }
    <linearGradient id="${id}-page" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#eceeff"/>
    </linearGradient>
    <filter id="${id}-sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1d1470" flood-opacity=".32"/>
    </filter>
    <filter id="${id}-psh" x="-20%" y="-60%" width="140%" height="220%">
      <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#1d1470" flood-opacity=".35"/>
    </filter>
  </defs>`;
}

/**
 * App-Symbol als SVG.
 * rounded: abgerundete Ecken (Favicon, In-App-Logo). Für iOS/Android randlos (das System maskiert selbst).
 * scale: Größe der Zeichnung – 1.07 für iOS (so groß wie möglich), kleiner für Androids runde Maske.
 */
export function iconSvg({ id = 'ic', rounded = false, scale = 1.07, size } = {}) {
  const r = rounded ? 114 : 0;
  // Zeichnung etwas nach links schieben: der Stift ragt rechts über das Blatt
  const t = `translate(256 256) scale(${scale}) translate(-270 -262)`;
  const wh = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${wh}>
  ${defs(id, true)}
  <rect width="512" height="512" rx="${r}" fill="url(#${id}-bg)"/>
  <rect width="512" height="512" rx="${r}" fill="url(#${id}-sheen)"/>
  <g transform="${t}">${artwork(id, false)}
  </g>
</svg>`;
}

// --- Startanimation -----------------------------------------------------------
// Ablauf (~1,1 s): Stift fliegt aufs Blatt, schreibt, das To-do wird abgehakt, dann zoomt alles weg.
// Der erste Frame (ohne Stift/Schrift/Häkchen) ist identisch mit den iOS-Startbildern.

export function splashMarkup() {
  return `<div id="splash" aria-hidden="true"><div class="sp-art"><svg viewBox="80 40 400 432">${defs('sp', false)}${artwork('sp', true)}</svg></div><div class="sp-name">${APP_NAME}</div></div>`;
}

export const SPLASH_CSS = `
#splash{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vmin;background:${SPLASH_BG};pointer-events:none;transition:opacity .36s ease .08s;-webkit-user-select:none;user-select:none}
#splash .sp-art{width:min(54vw,36vh,300px);transition:transform .5s cubic-bezier(.4,0,.2,1),opacity .34s ease}
#splash svg{display:block;width:100%;height:auto;overflow:visible}
#splash .sp-name{font:600 clamp(20px,5.2vw,30px)/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Rounded","SF Pro Display",system-ui,sans-serif;color:#fff;letter-spacing:.01em;opacity:0;animation:sp-name .5s ease .25s forwards}
#splash .sp-pen{animation:sp-pen 1s cubic-bezier(.3,.1,.3,1) both}
#splash .sp-ink{stroke-dashoffset:${INK_LEN};animation:sp-ink .52s linear .3s forwards}
#splash .sp-box{transform-box:fill-box;transform-origin:center;transform:scale(0);animation:sp-box .26s cubic-bezier(.3,1.6,.5,1) .84s forwards}
#splash .sp-check{stroke-dashoffset:${CHECK_LEN};animation:sp-check .2s ease-out .92s forwards}
#splash.out{opacity:0}
#splash.out .sp-art{transform:scale(1.22);opacity:0}
#splash.sp-static *{animation:none!important}
#splash.sp-static .sp-pen{opacity:0}
@keyframes sp-name{to{opacity:.95}}
@keyframes sp-ink{to{stroke-dashoffset:0}}
@keyframes sp-check{to{stroke-dashoffset:0}}
@keyframes sp-box{to{transform:scale(1)}}
@keyframes sp-pen{
0%{transform:translate(-40px,190px);opacity:0}
12%{opacity:1}
30%{transform:translate(-158px,14px)}
40.4%{transform:translate(-124px,6px)}
50.8%{transform:translate(-102px,14px)}
61.2%{transform:translate(-66px,4px)}
71.6%{transform:translate(-36px,8px)}
82%{transform:translate(0,0)}
100%{transform:translate(22px,-26px);opacity:1}}
@media (prefers-reduced-motion:reduce){
#splash *{animation:none!important}
#splash .sp-ink,#splash .sp-check{stroke-dashoffset:0}
#splash .sp-box{transform:none}
#splash .sp-name{opacity:.95}
#splash.out .sp-art{transform:none}}
`;

// Winziges Skript direkt nach dem Splash: blendet aus, sobald die App bereit ist (frühestens nach der Animation)
export const SPLASH_JS = `(function(){var s=document.getElementById('splash');if(!s)return;var d=document.documentElement;d.classList.add('splashing');
var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches,t0=performance.now(),ready=false,gone=false;
s.addEventListener('animationstart',function f(){t0=performance.now();s.removeEventListener('animationstart',f,true)},true);
function out(){if(gone)return;var w=(rm?150:1180)-(performance.now()-t0);if(w>0){setTimeout(out,w);return}gone=true;s.classList.add('out');d.classList.remove('splashing');var c=window.__splash.onend;c&&c();setTimeout(function(){s.remove()},650)}
window.__splash={done:function(){if(!ready){ready=true;out()}},onend:null};setTimeout(function(){ready=true;out()},4000)})();`;

// iOS-Startbilder (Home-Bildschirm-App): CSS-Größe im Hochformat und Pixeldichte
export const STARTUP_DEVICES = [
  // iPhone
  [440, 956, 3], [430, 932, 3], [420, 912, 3], [402, 874, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2],
  // iPad (auch quer)
  [1032, 1376, 2, true], [1024, 1366, 2, true], [834, 1210, 2, true], [834, 1194, 2, true], [820, 1180, 2, true], [810, 1080, 2, true], [744, 1133, 2, true], [768, 1024, 2, true],
];

export function startupImages() {
  const out = [];
  for (const [w, h, dpr, both] of STARTUP_DEVICES) {
    for (const landscape of both ? [false, true] : [false]) {
      const [vw, vh] = landscape ? [h, w] : [w, h];
      out.push({
        file: `startup-${vw * dpr}x${vh * dpr}.png`,
        width: vw,
        height: vh,
        dpr,
        media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${landscape ? 'landscape' : 'portrait'})`,
      });
    }
  }
  return out;
}
