'use client';

import {useEffect, useRef, useState} from 'react';
import {Mail, Send, X} from 'lucide-react';
import {phoneNational} from '@/lib/ru-phone';
import {PasswordField} from '@/components/auth/PasswordField';

type Channel = 'email' | 'telegram';
const CHANNELS = [
  {id: 'email', label: 'Почта', Icon: Mail, available: true},
  {id: 'telegram', label: 'Telegram', Icon: Send, available: true},
] as const;

export function PasswordRecovery({initialPhone, onClose, onSuccess}: {initialPhone: string; onClose: () => void; onSuccess: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [phone, setPhone] = useState(initialPhone);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [challenge, setChallenge] = useState<{token: string; url: string} | null>(null);
  const [email,setEmail]=useState('');
  const [mailAvailable,setMailAvailable]=useState<boolean|null>(null);
  useEffect(()=>{let active=true;fetch('/api/account/email',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(active)setMailAvailable(d.available===true);}).catch(()=>{if(active)setMailAvailable(false);});return()=>{active=false;};},[]);
  const [code,setCode]=useState('');
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
    if (busy || !channel) return;
    setError('');
    if (challenge && password !== confirmation) {setError('Пароли не совпадают. Проверьте повторный ввод.');return;}
    setBusy(true);
    try {
      const response = await fetch(channel==='email'?'/api/account/email':'/api/account/telegram', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(challenge?.url&&channel==='email'?{action:'complete',token:challenge.token}:challenge ? {action: 'reset', token: challenge.token, password,code} : {action: 'recover', phone,email}),
      });
      const data = await response.json();
      if (!alive.current) return;
      if (!response.ok) throw Error(data.error || 'Не удалось восстановить доступ. Попробуйте ещё раз.');
      if (challenge) {onSuccess();return;}
      if(channel==='email'&&!data.url){if(!/^[a-f0-9]{48}$/.test(data.token))throw Error('Не удалось начать восстановление.');setChallenge({token:data.token,url:''});return;}
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
          <input type="radio" name="recovery-channel" value={id} disabled={id==='email'&&mailAvailable===false} checked={channel === id} onChange={() => {setChannel(id);setError('');}}/>
          <Icon size={22}/><strong>{label}</strong><small>{id==='email'?(mailAvailable===false?'Пока недоступно':'Код или временный пароль'):'По номеру телефона'}</small>
        </label>)}
      </div></fieldset>
      {mailAvailable===false&&<p className="account-muted">Отправка писем пока не подключена. Выберите Telegram или обратитесь в поддержку.</p>}
      {channel==='email'&&!challenge&&<label>Электронная почта<input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email" maxLength={254} required/></label>}
      {channel === 'telegram' && !challenge && <p className="account-muted">Привязка в кабинете не нужна. Откройте бота и подтвердите свой номер кнопкой Telegram — он должен совпадать с номером регистрации.</p>}
      {challenge && <>
        {challenge.url&&<a className="account-telegram-link" href={challenge.url} target="_blank" rel="noopener noreferrer">Открыть подтверждение ↗</a>}
        {channel==='email'&&!challenge.url&&<><p className="account-muted">Если телефон и подтверждённая почта совпадают с данными кабинета, на почту отправлен код.</p><label>Код из письма<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></label></>}
        {challenge.url&&<p className="account-muted">Подтвердите номер регистрации кнопкой бота. Временный пароль придёт выбранным способом — в Telegram или на почту. Вернитесь к входу и введите его. Пароль действует 10 минут; после входа его можно изменить в профиле.</p>}
        {channel==='email'&&!challenge.url&&<><PasswordField label="Новый пароль" name="recovery-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={10} placeholder="Придумайте пароль"/>
        <PasswordField label="Повторите новый пароль" name="recovery-confirmation" value={confirmation} onChange={setConfirmation} autoComplete="new-password" minLength={10} placeholder="Повторите пароль"/></>}
        <button type="button" className="account-text-button" disabled={busy} onClick={() => {setChallenge(null);setPassword('');setConfirmation('');setError('');}}>Изменить телефон или способ</button>
      </>}
      {error && <p role="alert" className="account-error">{error}</p>}
      {challenge?.url&&channel==='telegram'?<button type="button" className="account-primary" onClick={onSuccess}>Вернуться ко входу</button>:<button className="account-primary" disabled={busy || !channel}>{busy ? 'Подождите…' : challenge?.url?'Отправить пароль на почту':challenge ? 'Сохранить новый пароль' : 'Продолжить'}</button>}
    </form>
  </dialog>;
}
