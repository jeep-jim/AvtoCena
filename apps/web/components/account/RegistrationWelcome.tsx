'use client';

import {useEffect, useState} from 'react';
import {CheckCircle2, X} from 'lucide-react';

export const REGISTRATION_WELCOME_KEY = 'avtocena:registration-welcome';

export function RegistrationWelcome({accountId, onConfigure}: {accountId?: string; onConfigure: () => void}) {
  const [visible, setVisible] = useState(false);
  const [mailAvailable, setMailAvailable] = useState(false);
  useEffect(() => {
    try { setVisible(!!accountId && sessionStorage.getItem(REGISTRATION_WELCOME_KEY) === accountId); } catch {}
  }, [accountId]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    fetch('/api/account/email', {cache: 'no-store'})
      .then(async response => response.ok && (await response.json()).available === true)
      .then(available => { if (active) setMailAvailable(available); })
      .catch(() => {});
    return () => { active = false; };
  }, [visible]);
  function dismiss() {
    setVisible(false);
    try { sessionStorage.removeItem(REGISTRATION_WELCOME_KEY); } catch {}
  }
  if (!visible) return null;
  return <section className="account-registration-welcome" aria-labelledby="registration-welcome-title">
    <CheckCircle2 className="account-registration-icon" size={30} aria-hidden="true"/>
    <div>
      <h2 id="registration-welcome-title">Поздравляем! Вы зарегистрированы в АвтоЦене 🎉</h2>
      <p>{mailAvailable
        ? 'Рекомендуем добавить и подтвердить почту и Telegram в профиле. Если забудете пароль, сможете восстановить доступ удобным способом.'
        : 'Рекомендуем подключить Telegram в профиле на случай, если забудете пароль. Добавление почты станет доступно после подключения отправки писем.'}</p>
      <button type="button" className="account-primary" onClick={() => {
        dismiss();
        onConfigure();
        requestAnimationFrame(() => {
          const section = document.getElementById('account-recovery-contacts');
          section?.scrollIntoView({block: 'start', behavior: 'auto'});
          section?.focus({preventScroll: true});
        });
      }}>Настроить восстановление</button>
    </div>
    <button type="button" className="account-registration-close" aria-label="Закрыть поздравление" onClick={dismiss}><X size={22}/></button>
  </section>;
}
