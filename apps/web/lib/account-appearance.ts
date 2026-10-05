export const ACCOUNT_ROLES = [
  {id: 'customer', label: 'Пользователь'},
  {id: 'dealer', label: 'АвтоДилер'},
  {id: 'blogger', label: 'Автоблогер'},
  {id: 'supplier', label: 'АвтоПоставщик'},
] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number]['id'];
export type AccountAppearance = Partial<Record<AccountRole, {banner: string; icon: string}>>;

export function normalizeAccountAppearance(value: unknown): AccountAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: AccountAppearance = {};
  for (const {id} of ACCOUNT_ROLES) {
    const media = raw[id];
    if (!media || typeof media !== 'object' || Array.isArray(media)) continue;
    const row = media as Record<string, unknown>;
    const clean = (value: unknown) => {
      if (value === '' || value === undefined) return '';
      if (typeof value !== 'string' || !/^\/api\/site-media\/[a-f0-9]{64}$/.test(value)) throw Error('Загрузите изображение с устройства');
      return value;
    };
    result[id] = {banner: clean(row.banner), icon: clean(row.icon)};
  }
  return result;
}
