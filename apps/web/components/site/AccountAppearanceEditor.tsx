'use client';

import {BetaApplications} from './BetaApplications';
import {useState} from 'react';
import {ImagePlus, Trash2} from 'lucide-react';
import {ACCOUNT_ROLES, type AccountAppearance} from '@/lib/account-appearance';

export function AccountAppearanceEditor({value, onChange, onBusyChange}: {
  value: AccountAppearance; onChange: (value: AccountAppearance) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function upload(role: typeof ACCOUNT_ROLES[number]['id'], kind: 'banner' | 'icon', file?: File) {
    if (!file) return;
    setBusy(`${role}-${kind}`); onBusyChange(true); setError('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw Error('Выберите JPG, PNG или WebP до 8 МБ');
      const body = new FormData(); body.set('file', file);
      const response = await fetch('/api/crm/site-media', {method: 'POST', body});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Не удалось загрузить изображение');
      onChange({...value, [role]: {...value[role], banner: value[role]?.banner || '', icon: value[role]?.icon || '', [kind]: data.url}});
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось загрузить изображение'); }
    finally { setBusy(''); onBusyChange(false); }
  }
  return <section className="border-b border-[var(--ac-border)] py-5" aria-labelledby="account-appearance-title">
    <h2 id="account-appearance-title" className="text-xl font-bold">Вход и регистрация</h2>
    <p className="mt-2 text-sm text-[var(--ac-muted)]">По умолчанию показываем анимированные возможности выбранной роли. Загрузите фон, чтобы заменить сцены изображением. Уберите фон, чтобы вернуть анимацию. Изменения появятся после сохранения.</p>
    <a className="mt-3 inline-block text-sm underline" href="/login" target="_blank" rel="noreferrer">Открыть страницу входа</a>
    <div className="mt-5 grid gap-6 lg:grid-cols-2">{ACCOUNT_ROLES.map(role => <section key={role.id} aria-label={role.label}>
      <h3 className="mb-3 font-bold">{role.label}</h3>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">{(['banner', 'icon'] as const).map(kind => {
        const url = value[role.id]?.[kind] || '';
        const title = kind === 'banner' ? 'Фон' : 'Иконка';
        return <div key={kind}>
          <p className="mb-2 text-sm font-semibold">{title}</p>
          <div className="flex h-36 items-center justify-center overflow-hidden rounded-xl bg-[var(--ac-surface-2)]">
            {url ? <img src={url} alt={`${title}: ${role.label}`} className={`h-full w-full ${kind === 'banner' ? 'object-cover' : 'object-contain p-3'}`}/> : <ImagePlus className="text-[var(--ac-muted)]" size={28}/>}
          </div>
          <label className="mt-2 block cursor-pointer rounded-xl border border-[var(--ac-border)] px-3 py-2 text-center text-sm font-semibold">
            {busy === `${role.id}-${kind}` ? 'Загрузка…' : url ? 'Заменить' : 'Загрузить'}
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Загрузить ${kind === 'banner' ? 'фон' : 'иконку'}: ${role.label}`} disabled={!!busy} onChange={event => {void upload(role.id, kind, event.target.files?.[0]); event.target.value = '';}}/>
          </label>
          {url && <button type="button" disabled={!!busy} className="mt-2 flex items-center gap-1 text-sm text-[var(--ac-muted)]" onClick={() => {if (confirm(`Убрать ${kind === 'banner' ? 'фон' : 'иконку'} для роли «${role.label}»?`)) onChange({...value, [role.id]: {banner: value[role.id]?.banner || '', icon: value[role.id]?.icon || '', [kind]: ''}});}}><Trash2 size={14}/> Убрать</button>}
        </div>;
      })}</div>
    </section>)}</div>
    <p className="mt-4 text-xs leading-5 text-[var(--ac-muted)]">Фон: рекомендуем 1200 × 1400 px, важные детали — по центру. Иконка: квадрат от 256 × 256 px, можно с прозрачным фоном. JPG, PNG или WebP до 8 МБ.</p>
    <BetaApplications/>
    {error && <p className="mt-3 text-sm text-red-500" role="alert">{error}</p>}
  </section>;
}
