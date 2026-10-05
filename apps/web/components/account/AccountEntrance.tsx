'use client';

import {phoneNational} from '@/lib/ru-phone';
import {accountPhoneError} from '@/lib/account/phone';
import {EntranceMediaPreview} from './EntranceMediaPreview';
import {EntranceDealerPreview} from './EntranceDealerPreview';
import {AccountScenes} from './AccountScenes';
import {ACCOUNT_SCENES} from './scene-content';
import {PasswordRecovery} from './PasswordRecovery';
import {useCallback,useRef,useState, type CSSProperties} from 'react';
import {ArrowUpRight, ArrowLeft, UserRound, Building2, Megaphone, Globe2} from 'lucide-react';
import {LoginForm} from '@/components/auth/LoginForm';
import {PasswordField} from '@/components/auth/PasswordField';
import {ACCOUNT_ROLES, type AccountRole, type AccountAppearance, type AccountMedia} from '@/lib/account-appearance';
import './account.css';
import './account-entrance.css';

type Mode = 'login' | 'register';

export function AccountEntrance({nextPath, errorCode, initialRole, appearance = {}}: {nextPath: string; errorCode: string; initialRole: string; appearance?: AccountAppearance}) {
  const [role, setRole] = useState<AccountRole>(initialRole === 'dealer' || initialRole === 'team' ? 'dealer' : initialRole === 'blogger' || initialRole === 'supplier' ? initialRole : 'customer');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [preview,setPreview]=useState<AccountMedia|null>(null);
  const closePreview=useCallback(()=>setPreview(null),[]);
  const formRef=useRef<HTMLElement>(null);
  const upcoming=role==='blogger'||role==='supplier';
  function showLogin(){formRef.current?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  const selectedArt = appearance[role];
  const scene = ACCOUNT_SCENES[role][sceneIndex % ACCOUNT_SCENES[role].length];
  function selectRole(next: AccountRole) {setRole(next); setSceneIndex(0);setPreview(null);}
  const RoleIcon = {customer: UserRound, dealer: Building2, blogger: Megaphone, supplier: Globe2}[role];
  const [mode, setMode] = useState<Mode>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({phone:false,password:false,confirmation:false,consent:false});
  const phoneError = touched.phone ? accountPhoneError(phone) : '';
  const passwordError = touched.password && (!password || (mode === 'register' && password.length < 10)) ? (mode === 'register' ? 'В пароле должно быть не менее 10 символов.' : 'Введите пароль.') : '';
  const confirmationError = mode === 'register' && (touched.confirmation || confirmation.length > 0) && (!confirmation || password !== confirmation) ? 'Пароли не совпадают. Проверьте повторный ввод.' : '';
  const [notice, setNotice] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setTouched({phone:false,password:false,confirmation:false,consent:false});
    setPhone(current => /^[+\d\s()–-]*$/.test(current) ? current : '');
    setPassword('');
    setConfirmation('');

    setError('');
    setNotice('');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const enteredPhone = String(fields.get('customer-phone') || '');
    const enteredPassword = String(fields.get('customer-password') || '');
    const repeatedPassword = String(fields.get('customer-password-confirmation') || '');
    const agreed = fields.get('customer-consent') === 'on';
    setPhone(enteredPhone); setPassword(enteredPassword); setConfirmation(repeatedPassword); setConsent(agreed);
    setTouched({phone:true,password:true,confirmation:true,consent:true});
    setError('');
    const invalid = accountPhoneError(enteredPhone) ? 'customer-phone'
      : !enteredPassword || (mode === 'register' && enteredPassword.length < 10) ? 'customer-password'
      : mode === 'register' && enteredPassword !== repeatedPassword ? 'customer-password-confirmation'
      : mode === 'register' && !agreed ? 'customer-consent' : '';
    if (invalid) {form.querySelector<HTMLInputElement>(`[name="${invalid}"]`)?.focus(); return;}
    setBusy(true);
    try {
      const response = await fetch('/api/account/auth', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: mode, phone: enteredPhone, password: enteredPassword, consent: agreed}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw Error(data.error || 'Не удалось войти. Попробуйте ещё раз.');
      // Confirm the customer cookie before navigating; a staff session is independent.
      const check = await fetch('/api/account/auth', {credentials:'same-origin', cache:'no-store'});
      const session = await check.json().catch(() => ({}));
      if (!check.ok || !session.account || session.account.id !== data.account?.id) {
        throw Error('Не удалось сохранить вход. Разрешите cookie для сайта и попробуйте войти ещё раз.');
      }
      const safe = /^\/account(?:[/?#]|$)/.test(nextPath) ? nextPath : '/account';
      window.location.assign(safe);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось подключиться. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="account-entrance account-original-design" style={{
    '--entrance-light-color':selectedArt?.colorLight||'#d7e7fa',
    '--entrance-dark-color':selectedArt?.colorDark||'#253e5b',
    '--entrance-light-image':selectedArt?.backgroundLight?`url("${selectedArt.backgroundLight}")`:'none',
    '--entrance-dark-image':selectedArt?.backgroundDark?`url("${selectedArt.backgroundDark}")`:'none',
  } as CSSProperties}>
    <header className="account-entrance-heading"><div className="entrance-eyebrow"><span/>{role === 'customer' ? 'Личный кабинет покупателя' : role === 'dealer' ? 'Кабинет автодилера' : role === 'blogger' ? 'Автоблогер' : 'Автопоставщик'}</div><h1>{upcoming ? ACCOUNT_ROLES.find(item=>item.id===role)?.label : selectedArt?.banner ? (role === 'customer' ? 'Ваш менеджер — на связи' : ACCOUNT_ROLES.find(item=>item.id===role)?.label) : role==='dealer'?'Ваша компания на АвтоЦене':scene.title}</h1><p>{upcoming ? 'Возможности для партнёров АвтоЦены' : selectedArt?.banner ? 'Заявки, общение и возможности вашего кабинета.' : role==='dealer'?'Личная страница компании и полноценная CRM для управления всем процессом: от заявки до выдачи автомобиля.':scene.description}</p></header>
    {!upcoming&&<button className="account-mobile-login account-primary" type="button" onClick={showLogin}>Войти</button>}
    {upcoming ? <section className="account-coming-soon">{selectedArt?.icon?<img className="account-coming-icon" src={selectedArt.icon} alt=""/>:<RoleIcon size={64}/>}<h2>{ACCOUNT_ROLES.find(item=>item.id===role)?.label}</h2><p>Этот раздел ещё в разработке, скоро появится ;)</p><button className="account-text-button" onClick={()=>selectRole('customer')}><ArrowLeft size={16}/> Пользователь</button></section> : <div className="account-login-main">
      <aside className={`account-welcome${selectedArt?.banner ? ' has-banner' : ''}`}>
        {selectedArt?.banner && <img className="account-welcome-background" src={selectedArt.banner} alt=""/>}
        {selectedArt?.banner ? <><div className="account-art-slot" data-role-art={role}>{selectedArt?.icon ? <img src={selectedArt.icon} alt=""/> : <RoleIcon size={64}/>}</div><h2>{role === 'customer' ? 'Ваш автомобиль. Всё рядом.' : ACCOUNT_ROLES.find(item=>item.id===role)?.label}</h2><p>Заявки, общение и возможности вашего кабинета.</p></> : role==='dealer'?<EntranceDealerPreview/>:<AccountScenes key={role} role={role} media={selectedArt?.media} onMediaOpen={setPreview} onSceneChange={setSceneIndex}/>}

      </aside>
      {preview&&<EntranceMediaPreview item={preview} onClose={closePreview}/>}
      <section hidden={!!preview} ref={formRef} id="account-login-form" className="account-login-form" data-mode={role === 'customer' ? mode : role}>
        <header className="account-selected-role">
          <div className="account-selected-icon" data-role-art={role}>{selectedArt?.icon?<img src={selectedArt.icon} alt=""/>:<RoleIcon size={44}/>}</div>
          <div className="account-selected-title">{role==='customer'?<a className="account-role-back" href="/" aria-label="Назад на главную"><ArrowLeft size={17}/> Назад</a>:<button type="button" className="account-role-back" aria-label="Пользователь" onClick={()=>selectRole('customer')}><ArrowLeft size={17}/> Назад</button>}<h2>{ACCOUNT_ROLES.find(item=>item.id===role)?.label}</h2></div>
        </header>
        {role === 'dealer' ? <>
          <LoginForm nextPath={nextPath.startsWith('/crm') ? nextPath : '/dealer-cabinet'} errorCode={errorCode}/>
        </> : <>
          <div className="account-tabs" role="group" aria-label="Вход или регистрация">
            <button disabled={busy} aria-pressed={mode === 'login'} onClick={() => changeMode('login')}>Вход</button>
            <button disabled={busy} aria-pressed={mode === 'register'} onClick={() => changeMode('register')}>Регистрация</button>
          </div>
          <form data-no-route-loader="true" key={mode} autoComplete={mode === 'register' ? 'off' : 'on'} id={`customer-${mode}`} name={`customer-${mode}`} action="/api/account/auth" method="post" onSubmit={submit} noValidate>
            <label>Телефон<input id="customer-phone" type="tel" inputMode="tel" name="customer-phone" value={phone} onChange={event => setPhone(`+7${phoneNational(event.target.value)}`)} onPaste={event=>{event.preventDefault();setPhone(`+7${phoneNational(event.clipboardData.getData("text"))}`);}} onBlur={event => {setPhone(event.currentTarget.value);setTouched(current=>({...current,phone:true}));}} autoComplete="section-customer tel" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Телефон" aria-invalid={!!phoneError} aria-describedby={phoneError?'customer-phone-error':undefined} maxLength={12} placeholder="+7 (___) ___-__-__" required/>{phoneError && <span id="customer-phone-error" role="alert" className="account-error">{phoneError}</span>}</label>
            <PasswordField key={mode} label="Пароль" name="customer-password" value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'section-customer current-password' : 'section-customer new-password'} error={passwordError} onBlur={()=>setTouched(current=>({...current,password:true}))} minLength={mode === 'login' ? 1 : 10} placeholder={mode === 'login' ? 'Введите пароль' : 'Придумайте пароль'}/>
            {mode === 'register' && password.length > 0 && <>
              <PasswordField label="Повторите пароль" name="customer-password-confirmation" value={confirmation} onChange={setConfirmation} autoComplete="section-customer new-password" error={confirmationError} onBlur={()=>setTouched(current=>({...current,confirmation:true}))} minLength={10} placeholder="Повторите пароль"/>
              <p className="account-muted">Запомните и сохраните пароль. Если забудете его, нажмите «Забыли пароль?» на странице входа.</p>
            </>}
            {mode === 'register' && <>
              <p className="account-muted">В пароле должно быть не менее 10 символов.</p>
              <label className="account-consent"><input type="checkbox" name="customer-consent" checked={consent} onChange={event => setConsent(event.target.checked)} required/><span>Согласен с <a href="/privacy" target="_blank" rel="noreferrer">условиями обработки персональных данных</a>.</span></label>
              {touched.consent && !consent && <p role="alert" className="account-error">Подтвердите согласие на обработку персональных данных.</p>}
            </>}
            {error && <p role="alert" className="account-error">{error}</p>}
            {notice && <p role="status" className="account-muted">{notice}</p>}
            <button className="account-primary" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти в кабинет' : 'Создать кабинет'}<ArrowUpRight size={20}/></button>
            {mode === 'login' && <button type="button" className="account-text-button" onClick={() => setRecoveryOpen(true)}>Забыли пароль?</button>}
          </form>
        </>}
      </section>
    </div>}
    {role==='dealer'&&<section className="account-dealer-benefits"><h2>Что получает Автодилер</h2><ul><li>Полноценная CRM: управление процессом от заявки до выдачи</li><li>Страница компании и отзывы покупателей</li><li>Каталог автомобилей в наличии и под заказ</li><li>Свои условия доставки и расчёты предложений</li><li>Заявки и контакты клиентов вашей компании</li><li>Документы и договоры по заявкам</li><li>Уведомления в подключённый Telegram компании</li></ul><p className="account-muted">В базовом доступе — страница компании, общий каталог, заявки и документы. Свои автомобили, фото выдач и расширенное оформление доступны в пробном периоде и по подписке. Кабинет открывается после подтверждения компании и вашего доступа.</p></section>}
    {recoveryOpen && <PasswordRecovery initialPhone={phone} onClose={() => setRecoveryOpen(false)} onSuccess={() => {setRecoveryOpen(false);changeMode('login');setNotice('Пароль изменён. Войдите с новым паролем.');}}/>}
    <div className="account-role-heading"><h2>Для партнёров</h2></div>
    <div className="account-roles">
      {ACCOUNT_ROLES.filter(item => item.id !== 'customer').map(item => {
        const Icon = {customer: UserRound, dealer: Building2, blogger: Megaphone, supplier: Globe2}[item.id];
        return <button key={item.id} aria-pressed={role === item.id} onClick={() => {selectRole(item.id); window.scrollTo({top: 0, behavior: 'smooth'});}}>
          <span className="account-role-art" data-role-art={item.id}>{appearance[item.id]?.icon ? <img src={appearance[item.id]?.icon} alt="" width={72} height={72}/> : <Icon size={28}/>}</span>
          <span><strong>{item.label}</strong><small>{item.id === 'dealer' ? 'Автомобили и клиенты' : 'Скоро появится'}</small></span><ArrowUpRight size={18}/>
        </button>;
      })}
    </div>
  </div>;
}
