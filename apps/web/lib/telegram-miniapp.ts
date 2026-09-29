export const MINI_APP_PATH = "/mini";
export const MINI_APP_URL = "https://avtocena.com/mini?utm_source=telegram&utm_medium=miniapp";
export function miniAppPathAllowed(path: string) {
  return path === "/mini" || path === "/cars" || path.startsWith("/cars/") || ["/favorites","/request","/privacy","/privacy/request","/terms","/consent","/requisites"].includes(path);
}
export function miniAppCatalogButton(chatId?: string) {
  return Number(chatId) > 0
    ? {text:"Открыть АвтоЦену",web_app:{url:MINI_APP_URL}}
    : {text:"Открыть АвтоЦену",url:MINI_APP_URL};
}
// Presentation only. Never use this flag, start_param or unverified Telegram data for authentication.
export const miniAppBootstrap = `(function(){try{var q=new URLSearchParams(location.search);if(q.get('mini')==='0'){sessionStorage.removeItem('avtocena_mini');return;}if(location.pathname==='/mini'||q.get('mini')==='1'){sessionStorage.setItem('avtocena_mini','1');}if(sessionStorage.getItem('avtocena_mini')==='1'&&(/^(\\/mini|\\/cars(?:\\/.*)?|\\/favorites|\\/request|\\/privacy(?:\\/request)?|\\/terms|\\/consent|\\/requisites)$/.test(location.pathname))){document.documentElement.dataset.miniapp='true';if(typeof localStorage!=='undefined'){var mt=localStorage.getItem('avtocena_mini_theme');if(mt==='light'||mt==='dark')document.documentElement.dataset.theme=mt;}}}catch(_){if(location.pathname==='/mini')document.documentElement.dataset.miniapp='true';}})();`;

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
  if(typeof start!=="string" || start.length>512 || !/^car_[A-Za-z0-9_-]+$/.test(start)) return null;
  try {
    const data = JSON.parse(atob(start.slice(4).replace(/-/g,"+").replace(/_/g,"/")));
    if(!Array.isArray(data) || data.length!==2 || typeof data[0]!=="string" || !publicOfferKey.test(data[0]) || typeof data[1]!=="string" || (data[1] && !publicOfferKey.test(data[1]))) return null;
    const query = new URLSearchParams({mini:"1"});
    if(data[1]) query.set("calculation",data[1]);
    return `/cars/offer/${encodeURIComponent(data[0])}?${query}`;
  } catch {return null;}
}
