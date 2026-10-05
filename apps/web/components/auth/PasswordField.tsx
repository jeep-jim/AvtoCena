'use client';

import {useState} from 'react';
import {Eye, EyeOff} from 'lucide-react';

export function PasswordField({label, name, value, onChange, placeholder, autoComplete = 'current-password', minLength = 1}: {
  label: string; name: string; value: string; onChange: (value: string) => void;
  placeholder: string; autoComplete?: string; minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="account-password-field">
    <input name={name} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} autoComplete={autoComplete} minLength={minLength} maxLength={128} placeholder={placeholder} required/>
    <button type="button" className="account-password-toggle" aria-label={`${visible ? 'Скрыть' : 'Показать'} пароль: ${label}`} aria-pressed={visible} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff size={20}/> : <Eye size={20}/>}</button>
  </span></label>;
}
