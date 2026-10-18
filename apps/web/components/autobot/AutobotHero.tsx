'use client';
import {useState} from 'react';
import {ArrowUpRight,ArrowUp} from 'lucide-react';
import {AutobotMascot} from './AutobotMascot';
import './Autobot.css';
export function openAutobot(text=''){window.dispatchEvent(new CustomEvent('autobot-open',{detail:{text}}));}
export function AutobotHero(){const [text,setText]=useState('');return <section className="ab-hero" aria-label="АвтоБот — помощник АвтоЦены" data-team-assistant><div className="ab-hero-copy"><div className="ab-eyebrow"><span/> АвтоБот · ИИ-помощник</div><h2>Твой напарник<br/>в мире автомобилей</h2><p>Подбор, характеристики и расчёт.<br/>Спроси меня — разберёмся вместе.</p></div><button className="ab-hero-character" aria-label="Познакомиться с АвтоБотом" onClick={()=>openAutobot()}><AutobotMascot large/><span>Привет! Я АвтоБот <ArrowUpRight size={14}/></span></button><form className="ab-hero-input" onSubmit={e=>{e.preventDefault();openAutobot(text);setText('');}}><input value={text} onChange={e=>setText(e.target.value)} maxLength={4000} placeholder="Какую машину ищешь?" aria-label="Вопрос АвтоБоту"/><button aria-label="Спросить АвтоБота" type="submit"><ArrowUp size={19}/></button></form><div className="ab-hero-chips">{['Подобрать авто','Объяснить утильсбор','Сравнить машины'].map(t=><button key={t} onClick={()=>openAutobot(t)}>{t}</button>)}</div></section>;}
