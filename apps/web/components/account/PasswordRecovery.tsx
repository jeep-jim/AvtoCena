'use client';

import {useEffect, useRef, useState} from 'react';
import {Mail, MessageCircle, Send, X} from 'lucide-react';
import {phoneNational} from '@/lib/ru-phone';
import {PasswordField} from '@/components/auth/PasswordField';

type Channel = 'email' | 'telegram' | 'max';
const CHANNELS = [
  {id: 'email', label: 'Почта', Icon: Mail, available: false},
  {id: 'telegram', label: 'Telegram', Icon: Send, available: true},
  {id: 'max', label: 'MAX', Icon: MessageCircle, available: false},
] as const;

export function PasswordRecovery({initialPhone, onClose, onSuccess}: {initialPhone: string; onClose: () => void; onSuccess: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [phone, setPhone] = useState(initialPhone);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [challenge, setChallenge] = useState<{token: string; url: string} | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {alive.current = false;element?.close();document.body.style.overflow = overflow;trigger?.focus();};
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || channel !== 'telegram') return;
    setError('');
    if (challenge && password !== confirmation) {setError('Пароли не совпадают. Проверьте повторный ввод.');return;}
    setBusy(true);
    try {
      const response = await fetch('/api/account/telegram', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(challenge ? {action: 'reset', token: challenge.token, password} : {action: 'recover', phone}),
      });
      const data = await response.json();
      if (!alive.current) return;
      if (!response.ok) throw Error(data.error || 'Не удалось восстановить доступ. Попробуйте ещё раз.');
      if (challenge) {onSuccess();return;}
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== 't.me' || !/^[a-f0-9]{48}$/.test(data.token)) throw Error('Не удалось начать восстановление. Попробуйте ещё раз.');
      setChallenge({token: data.token, url: url.href});
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Ошибка соединения. Попробуйте ещё раз.');
    } finally {if (alive.current) setBusy(false);}
  }

  return <dialog ref={dialog} className="account-recovery" aria-labelledby="recovery-title" onCancel={event => {event.preventDefault();onClose();}} onClick={event => {if (event.target === event.currentTarget) {const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose();}}}>
    <button type="button" className="recovery-close" aria-label="Закрыть восстановление пароля" onClick={onClose}><X size={21}/></button>
    <h2 id="recovery-title">Восстановление пароля</h2>
    <p className="account-muted">Введите номер телефона, указанный при регистрации, и выберите способ подтверждения для смены пароля.</p>
    <form data-no-route-loader="true" onSubmit={submit}>
      <label>Телефон, указанный при регистрации<input autoFocus type="tel" name="recovery-phone" autoComplete="tel" placeholder="+7 (___) ___-__-__" maxLength={12} required value={phone} disabled={busy || !!challenge} onChange={event => setPhone(`+7${phoneNational(event.target.value)}`)} onPaste={event=>{event.preventDefault();setPhone(`+7${phoneNational(event.clipboardData.getData("text"))}`);}}/></label>
      <fieldset disabled={busy || !!challenge}><legend>Куда отправить подтверждение?</legend><div className="recovery-channels">
        {CHANNELS.map(({id,label,Icon,available}) => <label key={id} className="recovery-channel" data-selected={channel === id}>
          <input type="radio" name="recovery-channel" value={id} checked={channel === id} onChange={() => {setChannel(id);setError('');}}/>
          <Icon size={22}/><strong>{label}</strong><small>{available ? 'Привязанный аккаунт' : 'Пока недоступно'}</small>
        </label>)}
      </div></fieldset>
      {channel && channel !== 'telegram' && <p role="status" className="account-muted">Восстановление через {channel === 'email' ? 'почту' : 'MAX'} пока недоступно. Выберите другой способ или обратитесь к вашему менеджеру.</p>}
      {channel === 'telegram' && !challenge && <p className="account-muted">Используйте аккаунт, который ранее подключили в кабинете.</p>}
      {challenge && <>
        <a className="account-telegram-link" href={challenge.url} target="_blank" rel="noopener noreferrer">Открыть подтверждение ↗</a>
        <p className="account-muted">Подтвердите запрос в выбранном приложении, затем задайте новый пароль. Подтверждение действует 10 минут.</p>
        <PasswordField label="Новый пароль" name="recovery-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={10} placeholder="Придумайте пароль"/>
        <PasswordField label="Повторите новый пароль" name="recovery-confirmation" value={confirmation} onChange={setConfirmation} autoComplete="new-password" minLength={10} placeholder="Повторите пароль"/>
        <button type="button" className="account-text-button" disabled={busy} onClick={() => {setChallenge(null);setPassword('');setConfirmation('');setError('');}}>Изменить телефон или способ</button>
      </>}
      {error && <p role="alert" className="account-error">{error}</p>}
      <button className="account-primary" disabled={busy || channel !== 'telegram'}>{busy ? 'Подождите…' : challenge ? 'Сохранить новый пароль' : 'Продолжить'}</button>
    </form>
  </dialog>;
}
