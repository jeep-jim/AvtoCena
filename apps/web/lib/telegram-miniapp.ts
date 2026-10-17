import {validProfilePart} from './dealers/profile-url';
export const MINI_APP_PATH = "/mini";
export const MINI_APP_URL = "https://avtocena.com/mini?utm_source=telegram&utm_medium=miniapp";
export function miniAppPathAllowed(path: string) {
  const parts=path.split("/");
  const dealer=parts.length===3&&validProfilePart(parts[1])&&validProfilePart(parts[2]);
  return /^\/s\/[A-Za-z0-9_-]{16}$/.test(path) || path === "/" || dealer || /^\/dealers\/[a-zA-Z0-9_-]{1,80}$/.test(path) || path === "/mini" || path === "/cars" || path.startsWith("/cars/") || ["/favorites","/request","/privacy","/privacy/request","/terms","/consent","/requisites"].includes(path);
}
export function miniAppCatalogButton(chatId?: string) {
  return Number(chatId) > 0
    ? {text:"Открыть АвтоЦену",web_app:{url:MINI_APP_URL}}
    : {text:"Открыть АвтоЦену",url:MINI_APP_URL};
}
// Presentation only: neither URL/storage flags nor an SDK object establish a
// Telegram host. Keep this function self-contained: it also runs before hydration.
export function syncMiniAppPresentation() {
  const root = document.documentElement;
  const host = window as Window & {
    TelegramWebviewProxy?: {postEvent?: unknown};
    external: External & {notify?: unknown};
  };
  let inTelegram = typeof host.TelegramWebviewProxy?.postEvent === "function"
    || typeof host.external?.notify === "function";
  if (!inTelegram && window.parent !== window) {
    const origins = [document.referrer];
    try { origins.push(...Array.from(location.ancestorOrigins || [])); } catch {}
    inTelegram = origins.some(value => {
      try { return new URL(value).origin === "https://web.telegram.org"; } catch { return false; }
    });
  }
  const query = new URLSearchParams(location.search);
  let optedOut = query.get("mini") === "0";
  try {
    // Remove the old sticky flag, including on ordinary desktop visits.
    sessionStorage.removeItem("avtocena_mini");
    if (!inTelegram) sessionStorage.removeItem("avtocena_mini_opt_out");
    else if (optedOut) sessionStorage.setItem("avtocena_mini_opt_out", "1");
    else if (location.pathname === "/mini" || query.get("mini") === "1") sessionStorage.removeItem("avtocena_mini_opt_out");
    else optedOut = sessionStorage.getItem("avtocena_mini_opt_out") === "1";
  } catch {}
  const parts=location.pathname.split('/');
  const reserved=new Set(['api','crm','admin','cars','auto','dealers','login','auth','privacy','terms','cookies','consent','results','favorites','autocalc','internal','telegram','mini','request','requisites','partner','osago','credit','mcp','sitemap','robots','health','settings','staff','_next']);
  const dealer=parts.length===3&&parts.slice(1).every(p=>/^[a-z][a-z0-9-]{1,39}$/.test(p)&&!reserved.has(p));
  const allowed = /^\/s\/[A-Za-z0-9_-]{16}$/.test(location.pathname) || location.pathname==='/' || dealer || /^\/dealers\/[a-zA-Z0-9_-]{1,80}$/.test(location.pathname) || /^(\/mini|\/cars(?:\/.*)?|\/favorites|\/request|\/privacy(?:\/request)?|\/terms|\/consent|\/requisites)$/.test(location.pathname);
  const active = inTelegram && allowed && !optedOut;
  if (active) {
    root.dataset.miniapp = "true";
    try {
      const theme = localStorage.getItem("avtocena_mini_theme");
      if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    } catch {}
  } else {
    delete root.dataset.miniapp;
    root.style.removeProperty("--ac-mini-top");
    root.style.removeProperty("--ac-mini-bottom");
  }
  return active;
}
export const miniAppBootstrap = `(${syncMiniAppPresentation.toString()})();`;

export const MINI_APP_SHARE_URL = "https://t.me/avtocena_bot?startapp=topavto";
export const MINI_APP_SHARE_TEXT = "🚗 АвтоЦена — каталог автомобилей из-за рубежа\n\nВыбирайте автомобили, задавайте фильтры и рассчитывайте стоимость прямо в Telegram.\n\nОткройте приложение по кнопке ниже 👇";

// Public navigation only: never interpret start_param as identity or permissions.
const publicOfferKey = /^[A-Za-z0-9_-]{1,160}$/;
export function miniAppOfferShareUrl(id: string, calculation?: string) {
  if (!publicOfferKey.test(id) || (calculation && !publicOfferKey.test(calculation))) return null;
  const payload = btoa(JSON.stringify([id, calculation || ""])).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const start = `car_${payload}`;
  return start.length <= 512 ? `https://t.me/avtocena_bot?startapp=${start}` : null;
}
export function miniAppLaunchPath(start: unknown): string | null {
  if(typeof start==='string' && /^short_[A-Za-z0-9_-]{16}$/.test(start))return `/s/${start.slice(6)}?open=web`;
  if(typeof start!=="string" || start.length>512 || !/^car_[A-Za-z0-9_-]+$/.test(start)) return null;
  try {
    const data = JSON.parse(atob(start.slice(4).replace(/-/g,"+").replace(/_/g,"/")));
    if(!Array.isArray(data) || data.length!==2 || typeof data[0]!=="string" || !publicOfferKey.test(data[0]) || typeof data[1]!=="string" || (data[1] && !publicOfferKey.test(data[1]))) return null;
    const query = new URLSearchParams({mini:"1"});
    if(data[1]) query.set("calculation",data[1]);
    return `/cars/offer/${encodeURIComponent(data[0])}?${query}`;
  } catch {return null;}
}
