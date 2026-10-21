"use client";
import type {ComponentProps} from 'react';
import {CitySelector} from '../home/CitySelector';
export function DeliveryCityPanel({description,...props}:ComponentProps<typeof CitySelector>&{description:string}){
 return <div className="mt-4 rounded-2xl bg-[var(--ac-surface-2)] p-4" data-city-delivery><p className="text-sm font-bold">Доставка до вашего города</p><CitySelector {...props}/><p className="mt-2 text-xs text-[var(--ac-muted)]">{description}</p></div>;
}
