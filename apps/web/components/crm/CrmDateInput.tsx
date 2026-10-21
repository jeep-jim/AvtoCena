"use client";
import {useRef,useState} from "react";
import {CalendarDays} from "lucide-react";
export function CrmDateInput({id,name,value,defaultValue="",onChange,calendar=true}:{id?:string;name:string;value?:string;defaultValue?:string;onChange?:(value:string)=>void;calendar?:boolean}){
 const [local,setLocal]=useState(defaultValue),input=useRef<HTMLInputElement>(null);
 const date=value??local;
 function open(){try{input.current?.showPicker?.();}catch{/* Native picker remains available through the input. */}}
 return <span className={`crm-date-control soft-input rounded-xl${calendar?" has-calendar":""}`}>
  <span className="crm-date-display" aria-hidden="true">{date?date.split("-").reverse().join("."):"дд.мм.гггг"}</span>
  {calendar&&<CalendarDays size={15} aria-hidden="true"/>}
  <input ref={input} id={id} name={name} type="date" value={date} onChange={event=>{setLocal(event.target.value);onChange?.(event.target.value);}} onClick={open} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open();}}}/>
 </span>;
}
