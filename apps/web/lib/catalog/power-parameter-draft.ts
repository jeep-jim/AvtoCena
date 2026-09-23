const KW_PER_HP = 0.73549875;
const pairs = [['powerHp', 'powerKw'], ['icePowerHp', 'icePowerKw'], ['power30MinHp', 'power30MinKw']] as const;
type Draft = Record<string, string>;
const converted = (value: string, multiplier: number) => {
 const n = Number(value.replace(',', '.'));
 return value.trim() && Number.isFinite(n) && n > 0 ? String(Number((n * multiplier).toFixed(8))) : '';
};
/** Convert units within one physical quantity; never infer certified power from peak power. */
export function powerUnitPatch(key: string, value: string, current: Draft = {}): Draft {
 const pair = pairs.find(keys => keys.includes(key as never));
 if (!pair) return {[key]: value};
 const [hp, kw] = pair;
 // Editing kW must preserve an existing hp value, including during clearing/retyping.
 if (key === kw && current[hp]?.trim()) return {[key]: value};
 return {[key]: value, [key === hp ? kw : hp]: converted(value, key === hp ? KW_PER_HP : 1 / KW_PER_HP)};
}
export function completePowerUnitDraft(input: Draft): Draft {
 const result = {...input};
 for (const [hp, kw] of pairs) {
  if (result[kw] && !result[hp]) result[hp] = converted(result[kw], 1 / KW_PER_HP);
  else if (result[hp] && !result[kw]) result[kw] = converted(result[hp], KW_PER_HP);
 }
 return result;
}
export function hybridResearchQuery(context: string, year: string, volume: string) {
 return `${context} ${year} ${volume} см³: определить точную модификацию и тип гибрида (последовательный или другой); найти мощность ДВС и максимальную 30-минутную мощность электродвигателей в кВт и л.с. по СБКТС, ЭПТС или документам производителя. Указать источники и номера документов. Не заменять 30-минутную мощность пиковой или суммарной мощностью системы; если подтверждения нет, написать, что данных нет.`;
}

export function electricResearchQuery(context: string, year: string) {
 return `${context} ${year}: электромобиль без ДВС. Найти максимальную 30-минутную мощность электродвигателя (сумму для нескольких двигателей) в кВт и л.с. по СБКТС, ЭПТС или документам производителя именно этой модификации. Указать проверяемый источник и номер документа. Не искать тип гибрида или мощность ДВС. Не заменять 30-минутную мощность пиковой, номинальной или ёмкостью батареи; не вычислять её как процент пиковой. Если подтверждения нет, написать «Нет подтверждённых данных».`;
}
