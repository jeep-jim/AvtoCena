import { catalogOfferVisibleRub } from './public-priority';
import { combustionPowerMismatch } from './combustion-power-consistency';

/** Describes facts, not a promise that a supplier still has a vehicle available. */
export function discoveryPrice(offer: any) {
  const archived = offer.catalogKind === 'auction_result' || offer.status === 'sold'
    || (offer.market === 'japan' && offer.catalogKind !== 'listing');
  const inactive = ['removed', 'stale'].includes(offer.status);
  const seller = offer.catalogPricingMode === 'seller';
  const deliveredRub = !seller && !inactive && !combustionPowerMismatch(offer) ? catalogOfferVisibleRub(offer) : 0;
  const sellerRub = seller && Number.isFinite(offer.sellerPriceRub) && offer.sellerPriceRub > 0
    ? Math.round(offer.sellerPriceRub) : 0;
  return {
    archived, inactive, deliveredRub, sellerRub,
    kind: archived ? 'auction_result' : seller ? 'seller' : deliveredRub ? 'import_estimate' : 'needs_data',
    label: archived ? 'Результат завершённых торгов' : seller ? 'Цена продавца без доставки и платежей'
      : deliveredRub ? 'Расчёт ввоза под ключ' : 'Для расчёта нужны характеристики',
    // Only admitted, non-preliminary live inventory belongs in a commercial feed.
    feedEligible: !archived && !inactive && !seller && deliveredRub > 0
      && offer.calculationSnapshot?.pricingConfidence !== 'preliminary'
      && !offer.modificationSelection,
  };
}

export function discoveryDescription(offer: any, name: string, market: string) {
  const state = discoveryPrice(offer);
  const money = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
  if (state.archived) return `${name}: статистика завершённых торгов, ${market}. Этот лот уже не является предложением к покупке.${state.deliveredRub ? ` Оценка ввоза аналогичного автомобиля: ${money(state.deliveredRub)}.` : ''}`;
  if (state.inactive) return `${name}, ${market}. Объявление больше не актуально; смотрите другие автомобили в каталоге.`;
  if (state.sellerRub) return `${name}, ${market}: цена продавца ${money(state.sellerRub)} без доставки и таможенных платежей. Для расчёта ввоза уточните недостающие характеристики в карточке.`;
  if (state.deliveredRub) return `${name}, ${market}: расчёт ввоза под ключ ${money(state.deliveredRub)}. Состав расходов, характеристики и дата обновления — в карточке. Наличие и итоговую стоимость подтверждает менеджер.`;
  return `${name}, ${market}: характеристики и данные источника. Полная стоимость ввоза пока не рассчитана — нужны недостающие параметры автомобиля.`;
}
