// Als App installieren: Android/Chrome über das Installationsfenster, iOS/iPadOS über „Zum Home-Bildschirm“
import { h, svg, storageGet, storageSet, toast } from './util.js';
import { I } from './icons.js';
import { APP_NAME, iconSvg } from './brand.js';

let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    storageSet('lr:installed', true);
    listeners.forEach((f) => f());
  });
}

export function onInstallChange(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/** Kann hier eine Installation angeboten werden? (nur gehostete Version im Browser) */
export function canInstall(app) {
  if (app.config.target !== 'hosted' || window.claude || isStandalone()) return false;
  return !!deferred || platform() !== 'desktop';
}

function hint() {
  const p = platform();
  if (p === 'ios') return /iPad|Macintosh/.test(navigator.userAgent) ? 'Oben rechts auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen.' : 'Unten auf „Teilen“ tippen und „Zum Home-Bildschirm“ wählen.';
  if (p === 'android') return 'Im Browsermenü ⋮ „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.';
  return 'Im Browser über das Installieren-Symbol in der Adressleiste.';
}

export async function promptInstall() {
  if (!deferred) {
    toast(hint());
    return false;
  }
  const e = deferred;
  deferred = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  listeners.forEach((f) => f());
  if (choice && choice.outcome === 'accepted') toast(`${APP_NAME} wird installiert`);
  return !!(choice && choice.outcome === 'accepted');
}

const sub = () => `Startet im Vollbild mit eigenem Symbol und funktioniert auch offline. ${deferred ? '' : hint()}`;

/** Zeile(n) für die Einstellungen */
export function installSection(app) {
  if (!canInstall(app)) return null;
  const row = h(
    deferred ? 'button' : 'div',
    { class: 'ios-row' + (deferred ? ' ios-row-action' : ''), type: deferred ? 'button' : null, onclick: deferred ? () => promptInstall() : null },
    h('span', { class: 'ios-row-ico install-ico', html: iconSvg({ id: 'ins', rounded: true }) }),
    h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' + (deferred ? ' tint' : '') }, deferred ? `${APP_NAME} installieren` : 'Zum Home-Bildschirm'), h('span', { class: 'ios-row-sub', style: { whiteSpace: 'normal' } }, sub()))
  );
  return h('div', {}, h('div', { class: 'section-label' }, 'Als App installieren'), h('div', { class: 'ios-list' }, row));
}

/** Karte auf „Heute“ – einmal wegklickbar */
export function installCard(app) {
  if (!canInstall(app) || storageGet('lr:installCardHidden', false)) return null;
  const p = platform();
  const sub = deferred
    ? h('div', { class: 'install-card-sub' }, 'Eigenes Symbol, Vollbild, auch offline.')
    : p === 'ios'
      ? h('div', { class: 'install-card-sub' }, 'Tippe auf ', h('span', { class: 'install-share' }, svg(I.share)), ' „Teilen“ und dann „Zum Home-Bildschirm“.')
      : h('div', { class: 'install-card-sub' }, hint());
  const card = h(
    'div',
    { class: 'install-card' },
    h('span', { class: 'install-card-ico', html: iconSvg({ id: 'inc', rounded: true }) }),
    h(
      'div',
      { class: 'install-card-main' },
      h('div', { class: 'install-card-title' }, `${APP_NAME} als App`),
      sub,
      deferred ? h('button', { class: 'btn btn-sm btn-prominent install-card-btn', type: 'button', onclick: async () => { if (await promptInstall()) card.remove(); } }, 'Installieren') : null
    ),
    h('button', { class: 'install-card-close', type: 'button', 'aria-label': 'Ausblenden', onclick: () => { storageSet('lr:installCardHidden', true); card.remove(); } }, svg(I.close))
  );
  return card;
}
