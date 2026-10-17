'use client';

import {useEffect, useState} from 'react';
import {CheckCircle2, X} from 'lucide-react';

export const REGISTRATION_WELCOME_KEY = 'avtocena:registration-welcome';

export function RegistrationWelcome({accountId, onConfigure}: {accountId?: string; onConfigure: () => void}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try { setVisible(!!accountId && sessionStorage.getItem(REGISTRATION_WELCOME_KEY) === accountId); } catch {}
  }, [accountId]);
  function dismiss() {
    setVisible(false);
    try { sessionStorage.removeItem(REGISTRATION_WELCOME_KEY); } catch {}
  }
  if (!visible) return null;
  return <section className="account-registration-welcome" aria-labelledby="registration-welcome-title">
    <CheckCircle2 className="account-registration-icon" size={30} aria-hidden="true"/>
    <div>
      <h2 id="registration-welcome-title">Поздравляем! Вы зарегистрированы в АвтоЦене 🎉</h2>
      <p>Если забудете пароль, восстановите доступ автоматически через Telegram или отправьте заявку в поддержку. Заявки по почте рассматриваются вручную и требуют времени.</p>
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
