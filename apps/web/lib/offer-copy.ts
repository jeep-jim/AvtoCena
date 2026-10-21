import type { AuthUser } from "./auth";

// Existing accounts predate this optional flag. Every account creation path
// explicitly writes false; owners can then opt individual users in or out.
export function canCopyOffer(user?: Pick<AuthUser, "status" | "offerCopyEnabled"> | null) {
  return Boolean(user && user.status !== "disabled" && user.offerCopyEnabled !== false);
}

export function offerCopySetting(actor: Pick<AuthUser, "role">, form: FormData): boolean | undefined {
  if (!form.has("offerCopyPresent") && !form.has("offerCopyEnabled")) return undefined;
  if (actor.role !== "owner") throw new Error("Настройку ромашки может менять только владелец");
  return form.get("offerCopyEnabled") === "on";
}

function number(value: unknown, zero = false) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && (zero ? n >= 0 : n > 0) ? n : null;
}

export function formatOfferCopy(input: {title:string;year:unknown;engineCc:unknown;powerHp:unknown;mileageKm:unknown;totalRub:unknown}) {
  const decimal = (n:number | null) => n === null ? "—" : n.toLocaleString("ru-RU", {useGrouping:false,maximumFractionDigits:2});
  const mileage = number(input.mileageKm, true);
  const total = number(input.totalRub);
  if (total === null) throw new Error("Дождитесь расчёта стоимости в рублях");
  return [input.title.replace(/\s+/g," ").trim(), `${decimal(number(input.year))} г`, `${decimal(number(input.engineCc, true))} см3`, `${decimal(number(input.powerHp))} лс`, `${mileage === null ? "—" : Math.round(mileage).toLocaleString("en-US").replace(/,/g,".")} км`, `${Math.round(total).toLocaleString("ru-RU").replace(/\s/g," ")} ₽`].join("\n");
}
