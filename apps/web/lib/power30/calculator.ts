export type Power30Kind = "BEV" | "PHEV" | "HEV" | "MHEV" | "ICE" | "unknown";
export type Power30Inputs = { kind: Power30Kind; peak: string; torque: string; rpm: string; voltage: string };
export const emptyPower30Inputs: Power30Inputs = {kind:"unknown",peak:"",torque:"",rpm:"",voltage:""};
export function estimatePower30(input: Power30Inputs) {
  if (!["BEV", "PHEV", "HEV", "MHEV"].includes(input.kind)) throw new Error("Выберите тип электромобиля или гибрида.");
  const values = [input.peak,input.torque,input.rpm,input.voltage].map(value => value.trim() === "" ? 0 : Number(value.replace(",", ".")));
  const [peak,torque,rpm,voltage] = values;
  if (values.some((v,i) => !Number.isFinite(v) || v < 0 || v > [2000,20000,100000,2000][i]) || peak <= 0) throw new Error("Проверьте параметры. Укажите положительную пиковую мощность электромоторов в кВт.");
  // Original owner-supplied heuristic. These coefficients are not measured R85 values.
  let ratio = input.kind === "BEV" ? .75 : input.kind === "PHEV" ? .65 : input.kind === "HEV" ? .5 : peak < 10 ? .2 : .4;
  const baseRatio = ratio;
  const torqueAdjustment = torque > 0 && rpm > 0 && torque * rpm / 9549 < .8 * peak;
  if (torqueAdjustment) ratio *= .85;
  if (voltage >= 400) ratio += .05;
  else if (voltage > 0 && voltage < 200) ratio -= .05;
  ratio = Math.min(.9,Math.max(.1,ratio));
  return {kw:peak*ratio,hp:peak*ratio*1.35962,ratio,baseRatio,torqueAdjustment};
}
export function power30OfferId(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Вставьте ссылку на автомобиль с avtocena.com.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Вставьте полную ссылку на автомобиль с avtocena.com."); }
  if (!["https:","http:"].includes(url.protocol) || !["avtocena.com","www.avtocena.com"].includes(url.hostname) || url.port || url.username || url.password) throw new Error("Поддерживаются только ссылки на автомобили с avtocena.com.");
  const path = url.pathname.match(/^\/cars\/offer\/([^/]+)\/?$/);
  if (!path) throw new Error("Нужна ссылка на карточку автомобиля, а не на каталог.");
  let segment: string;
  try {segment = decodeURIComponent(path[1]);} catch {throw new Error("Некорректная ссылка.");}
  const id = segment.includes("--") ? segment.slice(segment.lastIndexOf("--") + 2) : segment;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("Некорректный номер объявления.");
  return id;
}
export type Power30Car = {
  id: string; title: string; href: string; image?: string; inputs: Power30Inputs;
  inputSources: Partial<Record<keyof Power30Inputs,string>>;
  certified?: {kw:number; source:string; url?:string};
  notes: string[];
};
