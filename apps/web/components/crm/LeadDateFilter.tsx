"use client";
import {CrmDateInput} from "./CrmDateInput";
import {useState} from "react";
export function LeadDateFilter({date:appliedDate,filters}:{date:string;filters:Record<string,string>}){
 const [date,setDate]=useState(appliedDate);
 const clear=Boolean(appliedDate)&&(!date||date===appliedDate);
 const clearQuery=new URLSearchParams(Object.entries(filters).filter(([,value])=>value));
 return <form className="crm-lead-date-filter" action="/crm/leads">
  {Object.entries(filters).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>)}
  <label htmlFor="lead-date">Дата заявки <span>(МСК)</span></label>
  <CrmDateInput id="lead-date" name="date" value={date} onChange={setDate}/>
  {clear?<button type="button" className="crm-date-clear rounded-xl px-3 py-2 text-sm font-bold" onClick={()=>window.location.assign(`/crm/leads${clearQuery.size?`?${clearQuery}`:""}`)}>Очистить</button>:<button type="submit" disabled={!date} className="avto-button rounded-xl px-3 py-2 text-sm font-bold disabled:opacity-50">Показать</button>}
 </form>;
}
