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
export const miniAppBootstrap = `(function(){try{var q=new URLSearchParams(location.search);if(q.get('mini')==='0'){sessionStorage.removeItem('avtocena_mini');return;}if(location.pathname==='/mini'||q.get('mini')==='1'){sessionStorage.setItem('avtocena_mini','1');}if(sessionStorage.getItem('avtocena_mini')==='1'&&(/^(\\/mini|\\/cars(?:\\/.*)?|\\/favorites|\\/request|\\/privacy(?:\\/request)?|\\/terms|\\/consent|\\/requisites)$/.test(location.pathname))){document.documentElement.dataset.miniapp='true';}}catch(_){if(location.pathname==='/mini')document.documentElement.dataset.miniapp='true';}})();`;

export const MINI_APP_SHARE_URL = "https://t.me/avtocena_bot?startapp=topavto";
export const MINI_APP_SHARE_TEXT = "🚗 АвтоЦена — каталог автомобилей из-за рубежа\n\nВыбирайте автомобили, задавайте фильтры и рассчитывайте стоимость прямо в Telegram.\n\nОткройте приложение по кнопке ниже 👇";
