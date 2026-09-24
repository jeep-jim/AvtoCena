"use client";
import {useState} from "react";
import {ClientCreateForm} from "./ClientCreateForm";
export function ClientCreatePanel(){
 const [expanded,setExpanded]=useState(false);
 return <section className={`crm-client-create-panel${expanded?" is-expanded":""}`}>
  <button type="button" className="crm-client-create-toggle" aria-expanded={expanded} aria-controls="crm-client-create-fields" onClick={()=>setExpanded(value=>!value)}>Добавить клиента <span aria-hidden="true">{expanded?"−":"+"}</span></button>
  <div id="crm-client-create-fields"><ClientCreateForm /></div>
 </section>;
}
