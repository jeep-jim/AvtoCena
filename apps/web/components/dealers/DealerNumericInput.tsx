'use client';
import {useEffect,useRef,useState,type InputHTMLAttributes} from 'react';
import {numericDraft,formatNumericDraft,numericValue} from '@/lib/numeric-input';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'type'> & {value:string|number;onValueChange:(value:number)=>void;group?:boolean};
export function DealerNumericInput({value,onValueChange,group=false,...props}:Props){
 const canonical=()=>Number(value)?String(value).replace('.',','):'';
 const [draft,setDraft]=useState(canonical),focused=useRef(false);
 useEffect(()=>{if(!focused.current)setDraft(Number(value)?String(value).replace('.',','):'');},[value]);
 return <input {...props} type="text" inputMode="decimal" value={formatNumericDraft(draft,group)} onFocus={()=>{focused.current=true;}} onBlur={()=>{focused.current=false;setDraft(canonical());}} onChange={e=>{
  const input=e.currentTarget,raw=numericDraft(input.value);if(raw===null)return;
  const count=input.value.slice(0,input.selectionStart??input.value.length).replace(/\s/g,'').length;
  setDraft(raw);onValueChange(numericValue(raw));
  requestAnimationFrame(()=>{if(document.activeElement!==input)return;let i=0,n=0;while(i<input.value.length&&n<count){if(!/\s/.test(input.value[i]))n++;i++;}input.setSelectionRange(i,i);});
 }}/>;
}
