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
  "duplicate"
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Новая",
  assigned: "Назначена",
  contacted: "Первичный контакт",
  qualified: "Клиент подтверждён",
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
  duplicate: "Дубль"
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUSES.includes(value as LeadStatus);
}

export function leadStatusLabel(value?: string | null) {
  return isLeadStatus(value) ? LEAD_STATUS_LABELS[value] : value || LEAD_STATUS_LABELS.new;
}
