import { vehicleResearchUrl, type VehicleResearchIdentity } from "../catalog/vehicle-research-link";
export function browserResearchPrompt(id: string, identity: VehicleResearchIdentity) {
 if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw Error("invalid_offer");
 const research = vehicleResearchUrl(identity); if (!research) throw Error("invalid_offer");
 return `Пользователь уточняет характеристики автомобиля из каталога АвтоЦена (avtocena.com). Карточка: https://avtocena.com/cars/offer/${id} . Вопрос: ${new URL(research).searchParams.get("text")}. Проверь точную модификацию и приведи источники. Если данных недостаточно, прямо скажи, что нужно уточнить. Не придумывай мощность и не подменяй её данными другой версии. Это справочная консультация, а не подтверждённые параметры для таможенного расчёта.`;
}
