'use client';

import {useState} from 'react';

type Market = {id:string;name:string;currency:string};

/** Keep the displayed currency and submitted market together. */
export function CalculationMarketFields({markets,marketId,sourcePrice,inputClass}:{markets:Market[];marketId:string;sourcePrice:number;inputClass:string}) {
  const [selected,setSelected]=useState(marketId);
  const currency=markets.find(market=>market.id===selected)?.currency||'';
  return <>
    <label className="grid gap-1.5 text-xs font-black normal-case tracking-normal text-white/45">Рынок
      <select name="calcMarket" value={selected} className={inputClass} onChange={event=>{setSelected(event.target.value);event.currentTarget.form?.requestSubmit();}}>
        {markets.map(market=><option key={market.id} value={market.id}>{market.name}</option>)}
      </select>
    </label>
    <label className="grid gap-1.5 text-xs font-black normal-case tracking-normal text-white/45">Цена объявления, {currency}
      <input name="calcSourcePrice" type="number" min="1" step="1" defaultValue={sourcePrice} className={inputClass}/>
    </label>
  </>;
}
