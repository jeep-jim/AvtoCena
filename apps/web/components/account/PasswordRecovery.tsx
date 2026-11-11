'use client';
import {useEffect,useRef,useState} from 'react';
import {Mail,Send,X,CheckCircle2} from 'lucide-react';
import {phoneNational} from '@/lib/ru-phone';
type Channel='support'|'telegram';
export function PasswordRecovery({initialPhone,onClose,onSuccess}:{initialPhone:string;onClose:()=>void;onSuccess:(submitted?:boolean)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true);
 const [phone,setPhone]=useState(initialPhone),[channel,setChannel]=useState<Channel|null>(null),[email,setEmail]=useState(''),[consent,setConsent]=useState(false),[url,setUrl]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;const element=dialog.current,trigger=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;element?.showModal();document.body.style.overflow='hidden';return()=>{alive.current=false;element?.close();document.body.style.overflow=overflow;trigger?.focus();};},[]);
 async function submit(event:React.FormEvent){event.preventDefault();if(busy||!channel||url||sent)return;setBusy(true);setError('');try{
  const response=await fetch(channel==='telegram'?'/api/account/telegram':'/api/account/recovery-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(channel==='telegram'?{action:'recover',phone}:{phone,email,consent})}),data=await response.json();
  if(!alive.current)return;if(!response.ok)throw Error(data.error||'Не удалось отправить запрос. Попробуйте ещё раз.');
  if(channel==='support'){if(data.ok!==true)throw Error('Не удалось отправить заявку.');setSent(true);return;}
  const target=new URL(data.url);if(target.protocol!=='https:'||target.hostname!=='t.me'||!/^[a-f0-9]{48}$/.test(data.token))throw Error('Не удалось начать восстановление.');setUrl(target.href);
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Ошибка соединения. Попробуйте ещё раз.');}finally{if(alive.current)setBusy(false);}}
 return <dialog ref={dialog} className="account-recovery" aria-labelledby="recovery-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)onClose();}}}>
  <button type="button" className="recovery-close" aria-label="Закрыть восстановление пароля" onClick={onClose}><X size={21}/></button>
  <h2 id="recovery-title">Восстановление пароля</h2>
  {sent?<div role="status" className="recovery-request-success"><CheckCircle2 size={32}/><h3>Заявка отправлена в поддержку</h3><p>Мы рассмотрим обращение и проверим, что кабинет принадлежит вам. После проверки сотрудник вручную отправит временный пароль на указанную почту.</p><p>Это занимает время. Пожалуйста, дождитесь ответа поддержки.</p><button type="button" className="account-primary" onClick={()=>onSuccess(true)}>Вернуться ко входу</button></div>:<>
   <p className="account-muted">Введите номер телефона, указанный при регистрации, и выберите способ восстановления.</p>
   <form data-no-route-loader="true" onSubmit={submit}>
    <label>Телефон, указанный при регистрации<input autoFocus type="tel" name="recovery-phone" autoComplete="tel" placeholder="+7 (___) ___-__-__" maxLength={12} required value={phone} disabled={busy||!!url} onChange={e=>setPhone(`+7${phoneNational(e.target.value)}`)} onPaste={e=>{e.preventDefault();setPhone(`+7${phoneNational(e.clipboardData.getData('text'))}`);}}/></label>
    <fieldset disabled={busy||!!url}><legend>Как восстановить доступ?</legend><div className="recovery-methods">
     <button type="button" className="recovery-method recovery-method-telegram" aria-pressed={channel==='telegram'} onClick={()=>{setChannel('telegram');setError('');}}><Send size={25} aria-hidden="true"/><strong>Telegram</strong><span>Мгновенно, автоматически</span></button>
     <button type="button" className="recovery-method recovery-method-support" aria-pressed={channel==='support'} onClick={()=>{setChannel('support');setError('');}}><Mail size={25} aria-hidden="true"/><strong>Почта</strong><span>Ручная проверка, занимает время</span></button>
    </div></fieldset>
    {channel==='support'&&<><p className="account-muted">Отправьте заявку в поддержку. Предварительно привязывать почту не нужно. Сотрудник проверит владельца кабинета и отправит временный пароль вручную.</p><label>Почта для отправки временного пароля<input type="email" name="recovery-email" autoComplete="email" maxLength={254} value={email} required disabled={busy} onChange={e=>setEmail(e.target.value)}/></label><label className="recovery-consent"><input type="checkbox" required checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>Согласен на обработку данных для рассмотрения обращения согласно <a href="/privacy" target="_blank" rel="noopener noreferrer">политике конфиденциальности</a>.</span></label></>}
    {channel==='telegram'&&!url&&<p className="account-muted">Откройте бота и подтвердите свой номер кнопкой Telegram. Он должен совпадать с номером регистрации. Предварительная привязка не нужна.</p>}
    {url&&<><a className="account-primary account-telegram-button" href={url} target="_blank" rel="noopener noreferrer"><Send size={21} aria-hidden="true"/>Открыть Telegram</a><p className="account-muted">Подтвердите свой телефон кнопкой бота. Он пришлёт временный пароль в Telegram. Вернитесь ко входу и введите его. Пароль действует 10 минут и подходит для одного входа.</p><button type="button" className="account-text-button" onClick={()=>{setUrl('');setError('');}}>Изменить телефон или способ</button></>}
    {error&&<p role="alert" className="account-error">{error}</p>}
    {url?<button type="button" className="account-primary" onClick={()=>onSuccess()}>Вернуться ко входу</button>:<button className="account-primary" disabled={busy||!channel}>{busy?'Подождите…':channel==='support'?'Отправить заявку в поддержку':'Продолжить'}</button>}
   </form>
  </>}
 </dialog>;
}
