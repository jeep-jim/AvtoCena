"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LEAD_STATUSES, leadStatusLabel, leadMetrikaStage, type LeadStatus } from "@/lib/crm";

const explanations: Record<LeadStatus, {when: string; example?: string; note?: string}> = {
  new: {when: "Заявка поступила, менеджер ещё не начал её обрабатывать."},
  assigned: {when: "За заявкой закрепили ответственного менеджера. Само назначение ещё не означает, что с клиентом поговорили."},
  contacted: {when: "Начали связываться с клиентом: позвонили или написали. Потребность ещё уточняется либо ответа пока нет.", note: "Недозвон сам по себе не является спамом или отказом."},
  qualified: {when: "Связались с человеком и подтвердили интерес к покупке через нас. Выяснили, какой автомобиль нужен, бюджет под ключ и планируемый срок покупки. Клиент согласен продолжить: получить подборку, расчёт или обсудить варианты.", example: "«Нужен Fit из Японии до 1,3 млн ₽, покупка в следующем месяце. Пришлите варианты». Договор пока не нужен.", note: "Одной заполненной формы или оставленного телефона недостаточно. Если человек ещё не ответил, оставьте «Первичный контакт»."},
  selection: {when: "Требования клиента понятны, менеджер ищет и сравнивает подходящие автомобили."},
  offer_sent: {when: "Клиенту отправили конкретные варианты автомобилей или расчёт стоимости.", note: "Отправленное предложение ещё не означает подписанный договор или полученную оплату."},
  negotiation: {when: "Обсуждаете с клиентом варианты, цену и условия, отвечаете на вопросы и согласовываете следующий шаг."},
  contract_sent: {when: "Договор отправлен клиенту на ознакомление или подписание, но подписание ещё не подтверждено.", note: "Этот статус не включает цель «Договор / оплата»."},
  contract_signed: {when: "Подписание договора подтверждено. Выбирайте по факту подписания, а не после отправки документа.", note: "Передаётся цель «Договор / оплата». Оплата отмечается отдельно, когда деньги действительно поступили."},
  paid: {when: "Поступление предусмотренного договором платежа подтверждено.", note: "Обещание оплатить не считается оплатой. Этот статус связан с той же целью «Договор / оплата», что и подписанный договор."},
  in_progress: {when: "Идёт исполнение заказа: покупка, перевозка, таможенное оформление или другие согласованные работы."},
  delivered: {when: "Автомобиль фактически доставлен клиенту или в согласованное место выдачи."},
  completed: {when: "Работа по заявке завершена, согласованные обязательства выполнены, открытых задач не осталось."},
  rejected: {when: "Клиент отказался от покупки или продолжения работы либо выяснилось, что мы не можем выполнить запрос.", note: "Укажите причину в комментарии. Обычный отказ, неподходящий бюджет и отсутствие ответа не нужно помечать спамом."},
  spam: {when: "Подтверждённая нежелательная заявка: реклама чужих услуг, бот или заведомо фиктивное обращение.", example: "Вместо запроса на автомобиль прислали рекламу услуг.", note: "Недозвон и отказ от покупки — не спам. Сначала проверьте обстоятельства; для сохранения обязательна причина. Это сигнал о качестве трафика, а не успешная продажа."},
  duplicate: {when: "Это повтор уже существующей заявки по тому же обращению. Продолжайте работу в основной карточке.", note: "В комментарии укажите основную заявку и причину. Дубль не считается спамом."},
};

export function LeadStatusHelp({status}: {status?: string}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  return <>
    <button type="button" className="crm-status-help-button" aria-label={status ? `Что означает статус «${leadStatusLabel(status)}»` : "Расшифровка статусов заявок"} aria-haspopup="dialog" aria-controls={id} onClick={() => setOpen(true)}>?</button>
    <dialog ref={dialog} id={id} className="crm-status-help-dialog" aria-labelledby={`${id}-title`} onClose={() => setOpen(false)}>
      {open && <>
      <div className="crm-status-help-heading"><h2 id={`${id}-title`}>Когда выбирать статус</h2><button type="button" autoFocus aria-label="Закрыть расшифровку статусов" onClick={() => dialog.current?.close()}>×</button></div>
      <p className="crm-status-help-intro">Выбирайте статус по фактам общения с клиентом. После изменения нажмите «Сохранить» в карточке заявки.</p>
      {LEAD_STATUSES.map(value => {
        const help = explanations[value];
        const stage = leadMetrikaStage(value);
        return <details key={value} open={value === (status || 'qualified')} className="crm-status-help-item">
          <summary>{stage?.marker} {leadStatusLabel(value)}</summary>
          <div><p>{help.when}</p>{help.example && <p><strong>Пример: </strong>{help.example}</p>}{help.note && <p>{help.note}</p>}{stage && <p className="crm-status-help-goal">Цель Метрики: {stage.name}. Цветная отметка обозначает связь с целью, а не подтверждение отправки.</p>}</div>
        </details>;
      })}
      </>}
    </dialog>
  </>;
}
