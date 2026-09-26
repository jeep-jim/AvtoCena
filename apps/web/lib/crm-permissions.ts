import type {AuthUser} from './auth';
export const CRM_PERMISSIONS = {
 viewAll:{label:'Вся клиентская база',description:'Просмотр всех заявок и клиентов. Если выключено — только созданные или назначенные сотруднику.'},
 editClients:{label:'Изменение клиентов',description:'Добавление и редактирование контактов, комментариев и карточек клиентов.'},
 editLeads:{label:'Работа с заявками',description:'Создание заявок, смена статуса и добавление комментариев.'},
 assign:{label:'Назначение менеджеров',description:'Передача доступных заявок и клиентов другому сотруднику.'},
 documents:{label:'Документы и договоры',description:'Просмотр, загрузка, создание и редактирование документов доступных клиентов, работа с архивом.'},
 calculations:{label:'Сохранение расчётов',description:'Изменение сохранённого расчёта в карточке автомобиля и создание PDF.'},
 activityAll:{label:'Общая лента команды',description:'Просмотр событий всей команды. Доступ к самим клиентам и документам определяется отдельно.'},
 staff:{label:'Управление сотрудниками',description:'Для администратора: создание сотрудников, изменение прав, выдача ключей, даты рождения и документы сотрудников. Изменять владельцев может только владелец.'},
 settings:{label:'Рынки и настройки',description:'Для администратора: тарифы, расчёт, интеграции и партнёрские настройки. Общие шаблоны договоров изменяет только владелец.'},
 dealers:{label:'Управление дилерами',description:'Для администратора: просмотр и изменение данных дилеров.'},
} as const;
export type CrmPermission=keyof typeof CRM_PERMISSIONS;
export type CrmPermissions=Partial<Record<CrmPermission,boolean>>;
const managerDefaults=new Set<CrmPermission>(['editClients','editLeads','documents','calculations']);
const administrative=new Set<CrmPermission>(['staff','settings','dealers']);
export function hasCrmPermission(user:AuthUser|null|undefined,key:CrmPermission):boolean {
 if(!user||user.status==='disabled'||!['owner','admin','manager'].includes(user.role))return false;
 if(user.role==='owner')return true;
 if(user.role==='manager'&&administrative.has(key))return false;
 return user.permissions?.[key] ?? (user.role==='admin'||managerDefaults.has(key));
}
export function permissionDefaults(role:string){return Object.fromEntries((Object.keys(CRM_PERMISSIONS) as CrmPermission[]).map(k=>[k,role==='owner'||role==='admin'||managerDefaults.has(k)])) as Record<CrmPermission,boolean>;}
export const ROLE_DETAILS:Record<string,string>={owner:'Все разделы, вся клиентская база и лента. Управление владельцами, сотрудниками, ключами, тарифами, дилерами и общими шаблонами договоров. Полный доступ владельца не отключается.',admin:'По умолчанию — вся база, общая лента, назначения, документы, расчёты, команда, тарифы и дилеры. Не может изменять владельцев или общие шаблоны договоров. Права можно ограничить переключателями.',manager:'По умолчанию — созданные и назначенные ему клиенты и заявки, их документы и договоры, расчёты. Общие напоминания и рабочий график доступны всей команде; смены редактируются с подтверждением. Нет доступа к управлению командой, тарифами и дилерами. Дополнительный обзор и назначения включаются отдельно.'};
