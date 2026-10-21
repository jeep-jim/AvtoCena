'use client';

import {useRef, useState} from 'react';
import {Eye, EyeOff} from 'lucide-react';

export function PasswordField({label, name, value, onChange, placeholder, autoComplete = 'current-password', minLength = 1, error = '', onBlur}: {
  label: string; name: string; value: string; onChange: (value: string) => void;
  placeholder: string; autoComplete?: string; minLength?: number; error?: string; onBlur?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  function toggle() {
    const input = inputRef.current;
    // Password managers can fill the native value without a React change event.
    // Read it before changing type so a render cannot replace it with stale state.
    if (input) onChange(input.value);
    setVisible(current => !current);
    input?.focus({preventScroll: true});
  }
  return <label>{label}<span className="account-password-field">
    <input ref={inputRef} id={name} name={name} type={visible ? 'text' : 'password'} value={value}
      onChange={event => onChange(event.target.value)} onInput={event => onChange(event.currentTarget.value)}
      onBlur={event => {onChange(event.currentTarget.value); onBlur?.();}}
      autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
      aria-label={label} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined}
      minLength={minLength} maxLength={128} placeholder={placeholder} required/>
    <button type="button" className="account-password-toggle" aria-label={`${visible ? 'Скрыть' : 'Показать'} пароль: ${label}`} aria-pressed={visible}
      onPointerDown={event => event.preventDefault()} onClick={toggle}>{visible ? <EyeOff size={20}/> : <Eye size={20}/>}</button>
  </span>{error && <span id={`${name}-error`} role="alert" className="account-error">{error}</span>}</label>;
}
