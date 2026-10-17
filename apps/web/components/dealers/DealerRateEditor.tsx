'use client';
import {ExternalLink,RefreshCw} from 'lucide-react';
import {Field,Toggle} from './DealerEditorFields';
import type {DealerShowcase} from '@/lib/dealers/showcase-model';
export function DealerRateEditor({value,onChange,busy,status,onRefresh}:{value:DealerShowcase['pricing'];onChange:(v:Partial<DealerShowcase['pricing']>)=>void;busy:boolean;status:string;onRefresh:()=>void}){
 const auto=value.rateMode!=='manual';
 return <div className="dealer-rate-editor">
  <div className="dealer-pricing-heading"><div><h4>Курс для автомобиля и доставки</h4><a href="https://www.profinance.ru/chart/usdrub/" target="_blank" rel="noreferrer">Источник: Форекс · ProFinance <ExternalLink size={14}/></a></div><button type="button" className="dealer-rate-refresh" aria-label="Обновить курс" title={auto?'Обновить курс ProFinance':'Получить курс ProFinance и включить автообновление'} disabled={busy} onClick={onRefresh}><RefreshCw size={18} className={busy?'animate-spin':''}/><span>{busy?'Обновляем…':'Обновить'}</span></button></div>
  <div className="dealer-rate-values"><label className="grid gap-1 text-sm">Курс USD/RUB<input aria-invalid={!(value.usdRub>0)||!Number.isFinite(Date.parse(value.rateAt))||Date.now()-Date.parse(value.rateAt)>7*86400000||undefined} aria-label="Курс USD/RUB" className="soft-input w-full min-w-0 rounded-xl px-3 py-2 text-sm" type="number" step="any" min="0" disabled={auto} value={value.usdRub||''} placeholder="Укажите курс" onChange={e=>onChange({usdRub:Number(e.target.value),rateAt:new Date().toISOString()})}/></label><Field label="К курсу, ₽" type="number" value={value.fxMarkupRub} onChange={fxMarkupRub=>onChange({fxMarkupRub})}/><div className="dealer-rate-total"><span>Курс для расчёта</span><strong>{value.usdRub?(value.usdRub+value.fxMarkupRub).toLocaleString('ru-RU'):'—'} ₽</strong><small>USD/RUB + {value.fxMarkupRub.toLocaleString('ru-RU')} ₽</small></div></div>
  <Toggle label="Автоматически обновлять курс USD/RUB" value={auto} onChange={v=>onChange({rateMode:v?'auto':'manual'})}/>
  <p className="dealer-pricing-note" role="status">{status||(auto?'Обновляется каждые 15 минут. Для своего курса отключите автообновление.':'Ручной курс. Он применяется к стоимости автомобиля и доставке.')}</p>
 </div>;
}
