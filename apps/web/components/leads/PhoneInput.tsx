"use client";
import {useState} from "react";
import {phoneNational} from "@/lib/ru-phone";
export function PhoneInput({value: controlled, onChange, className = "", name, required = false}: {value?: string; onChange?: (value: string) => void; className?: string; name?: string; required?: boolean}) {
  const [local, setLocal] = useState("+7");
  const value=controlled ?? local;
  const change=(next: string) => {setLocal(next);onChange?.(next);};
  const national = value.startsWith("+7") ? value.slice(2) : phoneNational(value);
  return <div className={`soft-input flex h-[52px] items-center rounded-2xl bg-[var(--ac-surface-2)] px-4 ${className}`}>
    {name ? <input type="hidden" name={name} value={value} /> : null}
    <span className="mr-2 shrink-0" aria-hidden="true">+7</span>
    <input type="tel" required={required} pattern="[0-9]{10}" aria-label="Номер телефона, код страны +7" value={national} onChange={event => change(`+7${phoneNational(event.target.value)}`)}
      onPaste={event => {event.preventDefault(); change(`+7${phoneNational(event.clipboardData.getData("text"))}`);}}
      style={{color:"var(--ac-text)", WebkitTextFillColor:"var(--ac-text)"}} autoComplete="tel-national" inputMode="tel" placeholder="999 000 00 00" className="min-w-0 w-full bg-transparent outline-none" />
  </div>;
}
