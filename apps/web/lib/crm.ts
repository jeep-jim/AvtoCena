export const LEAD_STATUSES = [
  "new",
  "assigned",
  "contacted",
  "qualified",
  "selection",
  "offer_sent",
  "negotiation",
  "contract_sent",
  "contract_signed",
  "paid",
  "in_progress",
  "delivered",
  "completed",
  "rejected",
  "spam",
  "duplicate"
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Новая",
  assigned: "Назначена",
  contacted: "Первичный контакт",
  qualified: "Квалифицированный лид",
  selection: "Подбор автомобиля",
  offer_sent: "Предложение отправлено",
  negotiation: "Переговоры",
  contract_sent: "Договор отправлен",
  contract_signed: "Договор подписан",
  paid: "Оплата получена",
  in_progress: "В работе",
  delivered: "Автомобиль доставлен",
  completed: "Завершена",
  rejected: "Отказ",
  spam: "Спам",
  duplicate: "Дубль"
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUSES.includes(value as LeadStatus);
}

export function leadStatusLabel(value?: string | null) {
  return isLeadStatus(value) ? LEAD_STATUS_LABELS[value] : value || LEAD_STATUS_LABELS.new;
}

// UI markers describe the mapping, not delivery confirmation.
export const LEAD_METRIKA_STAGES: Record<string, {goal: string; name: string; marker: string; tone: string}> = {
  qualified: {goal: 'crm_qualified', name: 'Квалифицированный лид', marker: '🟢', tone: 'qualified'},
  contract_signed: {goal: 'crm_contract', name: 'Договор / оплата', marker: '🔵', tone: 'contract'},
  paid: {goal: 'crm_contract', name: 'Договор / оплата', marker: '🔵', tone: 'contract'},
  spam: {goal: 'crm_spam', name: 'Спам', marker: '🔴', tone: 'spam'},
};
export function leadMetrikaStage(status?: string | null) {
  return status && Object.hasOwn(LEAD_METRIKA_STAGES, status) ? LEAD_METRIKA_STAGES[status] : undefined;
}
export function leadStatusOptionLabel(status: string) {
  const stage = leadMetrikaStage(status);
  return `${stage ? stage.marker + ' ' : ''}${leadStatusLabel(status)}${stage ? ' · Метрика' : ''}`;
}
