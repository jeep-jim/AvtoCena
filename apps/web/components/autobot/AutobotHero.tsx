'use client';
import {useState} from 'react';
import {ArrowUp} from 'lucide-react';
import {AutobotMascot} from './AutobotMascot';
import './Autobot.css';
export function openAutobot(text=''){window.dispatchEvent(new CustomEvent('autobot-open',{detail:{text}}));}
export function AutobotHero(){const [text,setText]=useState('');return <section className="ab-hero" aria-label="АвтоБот — помощник АвтоЦены" data-team-assistant><div className="ab-hero-copy"><h2>Авто помощник — по частым вопросам!</h2></div><button className="ab-hero-character" aria-label="Открыть АвтоБота" onClick={()=>openAutobot()}><AutobotMascot large/></button><form className="ab-hero-input" onSubmit={e=>{e.preventDefault();openAutobot(text);setText('');}}><input value={text} onChange={e=>setText(e.target.value)} maxLength={4000} placeholder="Задайте Ваш вопрос" aria-label="Вопрос АвтоБоту"/><button aria-label="Спросить АвтоБота" type="submit"><ArrowUp size={19}/></button></form></section>;}
