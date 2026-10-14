'use client';

import {Field, input} from './DealerEditorFields';

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
  return <div className="grid content-start gap-1">
    <Field label={label} value={value} type={name === 'engineCc' ? 'number' : 'text'} invalid={invalid} onChange={onChange}/>
    <select className={`${input} min-h-11`} aria-label={`Выбрать вариант: ${label}`} value="" onChange={event => {
      if (event.target.value) onChange(name === 'engineCc' ? Number(event.target.value) : event.target.value);
    }}>
      <option value="" disabled>Выбрать вариант</option>
      {specificationChoices[name].map(choice => <option key={choice} value={choice}>{choice}{name === 'engineCc' ? ' см³' : ''}</option>)}
    </select>
    <span className="text-xs text-[var(--ac-muted)]">Можно вписать своё значение в поле выше.</span>
  </div>;
}
