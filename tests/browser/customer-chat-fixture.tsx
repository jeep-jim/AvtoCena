import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CustomerChat} from '../../apps/web/components/account/CustomerChat';
import {DealerColorField} from '../../apps/web/components/dealers/DealerColorField';
import '../../apps/web/components/account/account.css';
function Fixture(){
 const [color,setColor]=useState('Чёрный (#000000)'),[messages,setMessages]=useState<any[]>(Array.from({length:30},(_,i)=>({id:String(i),text:`Тестовое сообщение ${i+1}. Уточнение по заявке.`,author:i%2?'Тестовый покупатель':'Тестовый менеджер',mine:!!(i%2),createdAt:'2026-10-10T11:00:00Z'}))),[documents,setDocuments]=useState<string[]>([]);
 return <main className="customer-portal"><h1>Проверка чата</h1><DealerColorField value={color} onChange={setColor}/><CustomerChat client={{key:'fixture',manager:{name:'Тестовый менеджер'},messages}} account={{name:'Тестовый покупатель'}} onSend={async text=>setMessages(m=>[...m,{id:crypto.randomUUID(),text,author:'Тестовый покупатель',mine:true,createdAt:new Date().toISOString()}])} onUpload={async file=>{setDocuments(d=>[...d,file.name]);setMessages(m=>[...m,{id:crypto.randomUUID(),text:'Добавлен документ: '+file.name,system:true,author:'Оповещение',createdAt:new Date().toISOString()}]);}}/><section aria-label="Загруженные документы">{documents.join(', ')}</section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
