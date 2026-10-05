'use client';

import {AccountScenes} from './AccountScenes';
import {ACCOUNT_SCENES} from './scene-content';
import {PasswordRecovery} from './PasswordRecovery';
import {BetaApplication} from './BetaApplication';
import {useState} from 'react';
import {ArrowUpRight, ArrowLeft, UserRound, Building2, Megaphone, Globe2} from 'lucide-react';
import {LoginForm} from '@/components/auth/LoginForm';
import {PasswordField} from '@/components/auth/PasswordField';
import {ACCOUNT_ROLES, type AccountRole, type AccountAppearance} from '@/lib/account-appearance';
import './account.css';
import './account-entrance.css';

type Mode = 'login' | 'register';

export function AccountEntrance({nextPath, errorCode, initialRole, appearance = {}}: {nextPath: string; errorCode: string; initialRole: string; appearance?: AccountAppearance}) {
  const [role, setRole] = useState<AccountRole>(initialRole === 'dealer' || initialRole === 'team' ? 'dealer' : initialRole === 'blogger' || initialRole === 'supplier' ? initialRole : 'customer');
  const [sceneIndex, setSceneIndex] = useState(0);
  const selectedArt = appearance[role];
  const scene = ACCOUNT_SCENES[role][sceneIndex % ACCOUNT_SCENES[role].length];
  function selectRole(next: AccountRole) {setRole(next); setSceneIndex(0);}
  const RoleIcon = {customer: UserRound, dealer: Building2, blogger: Megaphone, supplier: Globe2}[role];
  const [mode, setMode] = useState<Mode>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setPassword('');
    setConfirmation('');

    setError('');
    setNotice('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmation) {
      setError('Пароли не совпадают. Проверьте повторный ввод.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/account/auth', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: mode, phone, password, consent}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Не удалось войти. Попробуйте ещё раз.');
      const safe = nextPath.startsWith('/account') && !nextPath.startsWith('//') ? nextPath : '/account';
      window.location.assign(safe);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось подключиться. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="account-entrance account-original-design">
    <header className="account-entrance-heading"><div className="entrance-eyebrow"><span/>{role === 'customer' ? 'Личный кабинет покупателя' : role === 'dealer' ? 'Кабинет автодилера' : role === 'blogger' ? 'Автоблогер · закрытая бета' : 'АвтоПоставщик · закрытая бета'}</div><h1>{selectedArt?.banner ? (role === 'customer' ? 'Ваш автомобиль — в пути' : ACCOUNT_ROLES.find(item=>item.id===role)?.label) : scene.title}</h1><p>{selectedArt?.banner ? 'Заявки, общение и возможности вашего кабинета.' : scene.description}</p></header>
    <div className="account-login-main">
      <aside className={`account-welcome${selectedArt?.banner ? ' has-banner' : ''}`}>
        {selectedArt?.banner && <img className="account-welcome-background" src={selectedArt.banner} alt=""/>}
        {selectedArt?.banner ? <><div className="account-art-slot" data-role-art={role}>{selectedArt?.icon ? <img src={selectedArt.icon} alt=""/> : <RoleIcon size={64}/>}</div><h2>{role === 'customer' ? 'Ваш автомобиль. Всё рядом.' : ACCOUNT_ROLES.find(item=>item.id===role)?.label}</h2><p>Заявки, общение и возможности вашего кабинета.</p></> : <AccountScenes key={role} role={role} onSceneChange={setSceneIndex}/>}

      </aside>
      <section className="account-login-form" data-mode={role === 'customer' ? mode : role}>
        {role === 'blogger' || role === 'supplier' ? <>
          <button className="account-text-button" onClick={() => selectRole('customer')}><ArrowLeft size={16}/> Пользователь</button>
          <h2>{ACCOUNT_ROLES.find(item => item.id === role)?.label}</h2>
          <BetaApplication key={role} role={role}/>
        </> : role === 'dealer' ? <>
          <button className="account-text-button" onClick={() => selectRole('customer')}><ArrowLeft size={16}/> Пользователь</button>
          <h2>Вход в кабинет</h2>
          <LoginForm nextPath={nextPath.startsWith('/crm') ? nextPath : '/dealer-cabinet'} errorCode={errorCode}/>
        </> : <>
          <div className="account-form-heading">
            <span className="account-kicker">Пользователь</span>
            <h2>{mode === 'login' ? 'Рады видеть вас' : 'Создайте свой кабинет'}</h2>
          </div>
          <div className="account-tabs" role="group" aria-label="Вход или регистрация">
            <button disabled={busy} aria-pressed={mode === 'login'} onClick={() => changeMode('login')}>Вход</button>
            <button disabled={busy} aria-pressed={mode === 'register'} onClick={() => changeMode('register')}>Регистрация</button>
          </div>
          <form onSubmit={submit}>
            <label>Телефон<input type="tel" name="phone" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" maxLength={22} placeholder="+7 (___) ___-__-__" required/></label>
            <PasswordField key={mode} label="Пароль" name="password" value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 10} placeholder={mode === 'login' ? 'Введите пароль' : 'Придумайте пароль'}/>
            {mode === 'register' && password.length > 0 && <>
              <PasswordField label="Повторите пароль" name="password-confirmation" value={confirmation} onChange={setConfirmation} autoComplete="new-password" minLength={10} placeholder="Повторите пароль"/>
              <p className="account-muted">Запомните и сохраните пароль. Если забудете его, нажмите «Забыли пароль?» на странице входа.</p>
            </>}
            {mode === 'register' && <>
              <p className="account-muted">В пароле должно быть не менее 10 символов.</p>
              <label className="account-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required/><span>Согласен с <a href="/privacy" target="_blank" rel="noreferrer">условиями обработки персональных данных</a>.</span></label>
            </>}
            {error && <p role="alert" className="account-error">{error}</p>}
            {notice && <p role="status" className="account-muted">{notice}</p>}
            <button className="account-primary" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти в кабинет' : 'Создать кабинет'}<ArrowUpRight size={20}/></button>
            {mode === 'login' && <button type="button" className="account-text-button" onClick={() => setRecoveryOpen(true)}>Забыли пароль?</button>}
          </form>
        </>}
      </section>
    </div>
    {recoveryOpen && <PasswordRecovery initialPhone={phone} onClose={() => setRecoveryOpen(false)} onSuccess={() => {setRecoveryOpen(false);changeMode('login');setNotice('Пароль изменён. Войдите с новым паролем.');}}/>}
    <div className="account-role-heading"><h2>Для партнёров</h2></div>
    <div className="account-roles">
      {ACCOUNT_ROLES.filter(item => item.id !== 'customer').map(item => {
        const Icon = {customer: UserRound, dealer: Building2, blogger: Megaphone, supplier: Globe2}[item.id];
        return <button key={item.id} aria-pressed={role === item.id} onClick={() => {selectRole(item.id); window.scrollTo({top: 0, behavior: 'smooth'});}}>
          <span className="account-role-art" data-role-art={item.id}>{appearance[item.id]?.icon ? <img src={appearance[item.id]?.icon} alt="" width={72} height={72}/> : <Icon size={28}/>}</span>
          <span><strong>{item.label}</strong><small>{item.id === 'dealer' ? 'Автомобили и клиенты' : 'Заявка в закрытую бету'}</small></span><ArrowUpRight size={18}/>
        </button>;
      })}
    </div>
  </div>;
}
