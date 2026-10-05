'use client';

import {BetaApplications} from './BetaApplications';
import {useState} from 'react';
import {ImagePlus, Trash2} from 'lucide-react';
import {ACCOUNT_ROLES, type AccountAppearance, type AccountArtwork} from '@/lib/account-appearance';

export function AccountAppearanceEditor({value, onChange, onBusyChange}: {
  value: AccountAppearance; onChange: (value: AccountAppearance) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function upload(role: typeof ACCOUNT_ROLES[number]['id'], kind: 'banner' | 'icon' | 'backgroundLight' | 'backgroundDark' | 'media', file?: File) {
    if (!file) return;
    setBusy(`${role}-${kind}`); onBusyChange(true); setError('');
    try {
      const video=kind==='media'&&(['video/mp4','video/quicktime','video/x-m4v'].includes(file.type)||(!file.type||file.type==='application/octet-stream')&&/\.(mov|mp4|m4v)$/i.test(file.name));
      if ((!video&&!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) || file.size > (video?32:8) * 1024 * 1024) throw Error('Выберите JPG, PNG, WebP до 8 МБ или MP4 или MOV до 32 МБ');
      const body = new FormData(); body.set('file', file);
      const response = await fetch('/api/crm/site-media', {method: 'POST', body});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Не удалось загрузить изображение');
      const current={banner:'',icon:'',...value[role]};
      onChange({...value,[role]:kind==='media'?{...current,media:[...(current.media||[]),{url:data.url,type:video?'video':'image',caption:file.name.replace(/\.[^.]+$/,'') }]}:{...current,[kind]:data.url}});
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось загрузить изображение'); }
    finally { setBusy(''); onBusyChange(false); }
  }
  function patch(role:typeof ACCOUNT_ROLES[number]['id'],changes:Partial<AccountArtwork>){onChange({...value,[role]:{banner:'',icon:'',...value[role],...changes}});}
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
          {url && <button type="button" disabled={!!busy} className="mt-2 flex items-center gap-1 text-sm text-[var(--ac-muted)]" onClick={() => {if (confirm(`Убрать ${kind === 'banner' ? 'фон' : 'иконку'} для роли «${role.label}»?`)) onChange({...value, [role.id]: {...value[role.id],banner: value[role.id]?.banner || '', icon: value[role.id]?.icon || '', [kind]: ''}});}}><Trash2 size={14}/> Убрать</button>}
        </div>;
      })}</div>
      <div className="mt-4 grid grid-cols-2 gap-3">{(['Light','Dark'] as const).map(theme=>{
        const colorKey=theme==='Light'?'colorLight':'colorDark',imageKey=theme==='Light'?'backgroundLight':'backgroundDark';
        const image=value[role.id]?.[imageKey];
        return <div key={theme}><h4 className="mb-2 text-sm font-semibold">{theme==='Light'?'Светлая тема':'Тёмная тема'}</h4>
          <label className="flex items-center gap-2 text-sm">Цвет фона<input type="color" aria-label={`Цвет фона: ${role.label}, ${theme==='Light'?'светлая':'тёмная'} тема`} value={value[role.id]?.[colorKey]||(theme==='Light'?'#d7e7fa':'#253e5b')} onChange={e=>patch(role.id,{[colorKey]:e.target.value})}/></label>
          {image&&<img src={image} alt="Фон блока" className="mt-2 h-24 w-full rounded-lg object-cover"/>}
          <label className="mt-2 block cursor-pointer text-sm underline">{image?'Заменить фон блока':'Загрузить фон блока'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={!!busy} aria-label={`Фон блока: ${role.label}, ${theme==='Light'?'светлая':'тёмная'} тема`} onChange={e=>{void upload(role.id,imageKey,e.target.files?.[0]);e.target.value='';}}/></label>
          {image&&<button type="button" className="mt-2 text-sm" onClick={()=>{if(confirm('Убрать фон блока?'))patch(role.id,{[imageKey]:''});}}>Убрать фон блока</button>}
        </div>;
      })}</div><p className="mt-2 text-xs text-[var(--ac-muted)]">Цвет и фон блока сохраняют анимацию. Изображение «Фон» выше заменяет её целиком.</p>
    </section>)}</div>
    <section className="mt-6" aria-label="Фото и видео в сцене файлов"><h3 className="font-bold">Фото и видео в сцене «Файлы»</h3><p className="mt-2 text-sm text-[var(--ac-muted)]">Добавьте до 6 материалов, например фотографии автомобиля и видео погрузки. Они будут видны всем посетителям страницы входа. JPG, PNG, WebP до 8 МБ, MP4 или MOV до 32 МБ.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{(value.customer?.media||[]).map((item,index)=><div key={item.url+index} className="rounded-xl border border-[var(--ac-border)] p-3">
        {item.type==='video'?<video src={item.url} controls preload="metadata" className="h-32 w-full object-contain"/>:<img src={item.url} alt={item.caption} className="h-32 w-full object-cover"/>}
        <label className="mt-2 block text-sm">Подпись<input className="mt-1 w-full rounded-lg border border-[var(--ac-border)] bg-[var(--ac-surface)] p-2" value={item.caption} maxLength={120} onChange={e=>patch('customer',{media:value.customer?.media?.map((m,i)=>i===index?{...m,caption:e.target.value}:m)})}/></label>
        <button type="button" disabled={!!busy} className="mt-2 text-sm" onClick={()=>{if(confirm('Убрать этот материал?'))patch('customer',{media:value.customer?.media?.filter((_,i)=>i!==index)});}}>Убрать</button>
      </div>)}</div>
      <label className="mt-3 inline-block cursor-pointer rounded-xl border border-[var(--ac-border)] px-4 py-2 text-sm">{busy==='customer-media'?'Загрузка…':'Добавить фото или видео'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v" aria-label="Добавить фото или видео в сцену файлов" disabled={!!busy||(value.customer?.media?.length||0)>=6} onChange={e=>{void upload('customer','media',e.target.files?.[0]);e.target.value='';}}/></label>
    </section>
    <p className="mt-4 text-xs leading-5 text-[var(--ac-muted)]">Фон: рекомендуем 1200 × 1400 px, важные детали — по центру. Иконка: квадрат от 256 × 256 px, можно с прозрачным фоном. JPG, PNG или WebP до 8 МБ.</p>
    <BetaApplications/>
    {error && <p className="mt-3 text-sm text-red-500" role="alert">{error}</p>}
  </section>;
}
