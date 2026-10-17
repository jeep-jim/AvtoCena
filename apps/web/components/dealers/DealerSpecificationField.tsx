'use client';

import {useRef, useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {input} from './DealerEditorFields';
import {DealerNumericInput} from './DealerNumericInput';

export const specificationChoices = {
  drive: ['Передний', 'Задний', 'Полный'],
  transmission: ['Автомат (АКПП)', 'Механика (МКПП)', 'Робот', 'Вариатор (CVT)'],
  body: ['Седан', 'Хэтчбек', 'Лифтбек', 'Универсал', 'Кроссовер', 'Внедорожник', 'Минивэн', 'Купе', 'Кабриолет', 'Пикап', 'Фургон'],
  engineCc: Array.from({length: 61}, (_, index) => String(600 + index * 100)),
} as const;

/** Suggestions never normalize or replace an existing value until selected. */
export function DealerSpecificationField({name, label, value, invalid, onChange}: {
  name: keyof typeof specificationChoices;
  label: string;
  value: string | number;
  invalid?: boolean;
  onChange: (value: string | number) => void;
}) {
  const [manual, setManual] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const selected = name === 'engineCc' && !Number(value) ? '' : String(value);
  const choices: readonly string[] = specificationChoices[name];
  const custom = selected !== '' && !choices.includes(selected);
  const showChoices = () => {
    setManual(false);
    requestAnimationFrame(() => select.current?.focus());
  };
  return <label className="grid content-start gap-1 text-sm" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setManual(false);
  }}>
    {label}
    {manual ? <span className="relative block" onKeyDown={event => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        showChoices();
      }
    }}>
      {name === 'engineCc'
        ? <DealerNumericInput autoFocus aria-invalid={invalid || undefined} className={`${input} pr-11`} value={value} onValueChange={onChange}/>
        : <input autoFocus aria-invalid={invalid || undefined} className={`${input} pr-11`} value={value} onChange={event => onChange(event.target.value)}/>}
      <button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl" aria-label={`Выбрать из списка: ${label}`} onMouseDown={event => event.preventDefault()} onClick={showChoices}>
        <ChevronDown size={16} aria-hidden="true"/>
      </button>
    </span> : <select ref={select} className={input} aria-invalid={invalid || undefined} value={selected} onChange={event => {
      const next = event.target.value;
      if (next === '__manual__') { setManual(true); return; }
      onChange(name === 'engineCc' ? Number(next) : next);
    }}>
      <option value="">Не указан{ name === 'transmission' ? 'а' : ''}</option>
      {custom && <option value={selected}>{selected}{name === 'engineCc' ? ' см³' : ''}</option>}
      {choices.map(choice => <option key={choice} value={choice}>{choice}{name === 'engineCc' ? ' см³' : ''}</option>)}
      <option value="__manual__">Другое…</option>
    </select>}
  </label>;
}
