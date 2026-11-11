"use client";
import {useState} from "react";
import {leadContact} from "@/lib/lead-contact";
export function LeadContact({lead,interactive=false}:{lead:any;interactive?:boolean}){
 const contact=leadContact(lead),[notice,setNotice]=useState("");
 if(!interactive)return <span className="crm-contact-text" aria-label={`${contact.label}: ${contact.value||"Контакт не указан"}`}><strong>{contact.value||"Контакт не указан"}</strong>{contact.detail&&<small>{contact.detail}</small>}</span>;
 const className=`crm-contact-action ${contact.channel==="telegram"?"crm-contact-telegram":contact.channel==="max"?"crm-contact-max":"crm-contact-call"}`;
 const content=<><strong>{contact.channel==="call"?"Позвонить":`Написать в ${contact.label}`}</strong><span>{contact.value||"Контакт не указан"}</span></>;
 if(contact.href)return <a className={className} href={contact.href} target={contact.channel==="call"?undefined:"_blank"} rel="noreferrer">{content}</a>;
 if(contact.channel==="max"&&contact.value)return <span className="crm-contact-fallback"><a className={className} href="https://web.max.ru/" target="_blank" rel="noreferrer" onClick={()=>{setNotice("Найдите контакт через поиск в MAX.");void navigator.clipboard?.writeText(contact.value.replace(/^@/,"")).then(()=>setNotice("Контакт скопирован. Вставьте его в поиск MAX; для телефона выберите «Найти по номеру».")).catch(()=>setNotice("Скопируйте контакт и найдите его через поиск в MAX."));}}><strong>Открыть MAX и скопировать контакт</strong><span>{contact.value}</span></a>{notice&&<small role="status">{notice}</small>}</span>;
 return <span className="crm-contact-text">{contact.value||"Контакт не указан"}</span>;
}
