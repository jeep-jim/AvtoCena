import type { CrmActivity } from './crm-activity';

export type ActivityGroup = { id: string; section: string; events: CrmActivity[] };
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Novokuznetsk', year: 'numeric', month: '2-digit', day: '2-digit' });
const sections: Record<string, string> = { leads: 'Заявки', clients: 'Клиенты', documents: 'Документы', contracts: 'Договоры', managers: 'Команда', team: 'Команда', markets: 'Рынки', offers: 'Автомобили', dealers: 'Дилеры' };

function sectionFor(event: CrmActivity) {
  const path = event.href?.match(/^\/crm\/([^/?#]+)/)?.[1];
  if (path && sections[path]) return sections[path];
  const entity: Record<string, string> = { review: 'Отзывы', lead: 'Заявки', client: 'Клиенты', document: 'Документы', contract: 'Договоры', staff: 'Команда', offer: 'Автомобили' };
  return entity[event.entityType || ''] || event.entityType || event.type;
}

/** Group only the events already authorized by the activity API. Keep every detail. */
export function groupCrmActivity(events: CrmActivity[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  for (const event of [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const section = sectionFor(event);
    const actor = event.actor?.id || event.managerId;
    const date = new Date(event.createdAt);
    // Website events and malformed timestamps must not swallow unrelated leads.
    const key = actor && Number.isFinite(date.getTime())
      ? JSON.stringify([actor, section, dayFormat.format(date)]) : event.id;
    const group = groups.get(key);
    if (group) group.events.push(event);
    else groups.set(key, { id: key, section, events: [event] });
  }
  return [...groups.values()];
}
