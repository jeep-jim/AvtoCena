import { readDataJson, mutateDataJson } from "../data";
import {
  defaultShowcase,
  normalizeShowcase,
  PILOT_DEALER_ID,
  type DealerShowcase,
} from "./showcase-model";
export function validDealerId(id: string) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id) && !id.includes("__");
}
export async function findDealer(id: string) {
  if (!validDealerId(id)) return null;
  const rows = await readDataJson<any[]>("dealers/dealers.json", []);
  return (
    (rows.length ? rows : [{ id: PILOT_DEALER_ID, name: "TopAvto" }]).find(
      (d) => d.id === id,
    ) || null
  );
}
export async function readShowcase(id: string) {
  const dealer = await findDealer(id);
  if (!dealer) return null;
  return readDataJson<DealerShowcase>(
    `dealers/showcases/${id}.json`,
    defaultShowcase(id, dealer.name),
  );
}
export async function saveShowcase(id: string, raw: any) {
  if (!(await findDealer(id))) throw Error("Компания не найдена");
  let saved!: DealerShowcase;
  await mutateDataJson<DealerShowcase>(
    `dealers/showcases/${id}.json`,
    defaultShowcase(id),
    (current) => {
      if (current.version !== raw.version)
        throw Error(
          "Настройки уже изменились. Обновите страницу перед сохранением",
        );
      saved = normalizeShowcase(raw, id, current.version + 1);
      return saved;
    },
  );
  return saved;
}
export type PublicFeatures = { version: number; affiliatesEnabled: boolean };
export function readPublicFeatures() {
  return readDataJson<PublicFeatures>("settings/public-features.json", {
    version: 0,
    affiliatesEnabled: true,
  });
}
export async function savePublicFeatures(raw: PublicFeatures) {
  let saved!: PublicFeatures;
  await mutateDataJson<PublicFeatures>(
    "settings/public-features.json",
    { version: 0, affiliatesEnabled: true },
    (current) => {
      if (current.version !== raw.version)
        throw Error("Настройки сервисов изменились. Обновите страницу");
      saved = {
        version: current.version + 1,
        affiliatesEnabled: raw.affiliatesEnabled === true,
      };
      return saved;
    },
  );
  return saved;
}
