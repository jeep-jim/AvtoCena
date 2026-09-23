"use client";
import {metrikaAttribution,METRIKA_COUNTER} from "./metrika-client";

type CaptchaApi = {
  render: (node: HTMLElement, options: {sitekey:string; hl:string; callback:(token:string)=>void}) => number;
  destroy: (id:number) => void;
  subscribe: (id:number, event:string, callback:()=>void) => () => void;
};
let loading: Promise<CaptchaApi> | undefined;
function loadCaptcha(): Promise<CaptchaApi> {
  const win = window as typeof window & {smartCaptcha?: CaptchaApi; acCaptchaReady?: () => void};
  if (win.smartCaptcha) return Promise.resolve(win.smartCaptcha);
  if (!loading) loading = new Promise<CaptchaApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => { script.remove(); reject(new Error("Капча не загрузилась. Проверьте соединение и повторите отправку.")); }, 15000);
    win.acCaptchaReady = () => { clearTimeout(timer); if (win.smartCaptcha) resolve(win.smartCaptcha); };
    script.src = "https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=acCaptchaReady";
    script.async = true;

    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("Капча не загрузилась. Повторите отправку.")); };
    document.head.appendChild(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}
async function challenge(sitekey: string): Promise<string> {
  const api = await loadCaptcha();
  return new Promise((resolve, reject) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:20050;display:flex;align-items:center;justify-content:center;padding:12px;background:#000b;overflow:auto";
    const panel = document.createElement("div");
    panel.style.cssText = "background:white;color:#171717;padding:20px;border-radius:16px;width:100%;max-width:380px";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Подтверждение отправки");
    const title = document.createElement("p"); title.textContent = "Подтвердите отправку заявки";
    const widget = document.createElement("div"); widget.style.minHeight = "100px";
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Вернуться к форме";
    close.style.cssText = "display:block;margin-top:16px;padding:12px;cursor:pointer";
    panel.append(title, widget, close); overlay.append(panel); document.body.append(overlay); close.focus();
    let widgetId: number | undefined;
    let settled = false;
    const unsubscribe: Array<()=>void> = [];
    const cleanup = () => { clearTimeout(timer); document.removeEventListener("keydown", keydown, true); unsubscribe.forEach(fn => fn()); if (widgetId !== undefined) api.destroy(widgetId); overlay.remove(); previousFocus?.focus(); };
    const finish = (token?: string, message = "Проверка отменена. Заявка осталась в форме.") => { if (settled) return; settled = true; cleanup(); token ? resolve(token) : reject(new Error(message)); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); finish(); } };
    const timer = setTimeout(() => finish(undefined, "Время проверки истекло. Повторите отправку."), 180000);
    document.addEventListener("keydown", keydown, true);
    close.onclick = () => finish();
    try {
      widgetId = api.render(widget, {sitekey, hl:"ru", callback: token => { if(token) finish(token); }});
      for (const event of ["network-error", "javascript-error"]) unsubscribe.push(api.subscribe(widgetId, event, () => finish(undefined, "Ошибка проверки. Повторите отправку.")));
    }
    catch { finish(undefined, "Не удалось открыть капчу. Повторите отправку."); }
  });
}

// All public lead forms share the same server-requested challenge and preserve payload/operationId.
export async function leadFetch(url: string, init: RequestInit): Promise<Response> {
  const payload = JSON.parse(String(init.body || "{}"));
  payload.operationId ||= crypto.randomUUID();
  payload.attribution = {...payload.attribution,...await metrikaAttribution()};
  const send = async () => {
    const response=await fetch(url, {...init, body:JSON.stringify(payload)});
    if(response.ok) {
      try {
        const key=`ac_metrika_lead_${payload.operationId}`;
        if(!sessionStorage.getItem(key)){window.ym?.(METRIKA_COUNTER,'reachGoal','lead_submitted');sessionStorage.setItem(key,'1');}
      } catch { /* Analytics must never interrupt a saved application. */ }
    }
    return response;
  };
  const response = await send();
  if (response.status !== 429) return response;
  const result = await response.clone().json().catch(() => ({}));
  if (result.code !== "captcha_required" || !result.sitekey) return response;
  payload.captchaToken = await challenge(result.sitekey);
  return send();
}
