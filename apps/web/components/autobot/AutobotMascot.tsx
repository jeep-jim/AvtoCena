'use client';
export function AutobotMascot({busy=false,large=false}:{busy?:boolean;large?:boolean}){return <span aria-hidden="true" className={'ab-mascot'+(busy?' ab-mascot--busy':'')+(large?' ab-mascot--large':'')}><span className="ab-mascot-sprite"/></span>;}
