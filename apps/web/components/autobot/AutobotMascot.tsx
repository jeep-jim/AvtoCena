'use client';
export function AutobotMascot({busy=false,large=false,speaking=false}:{busy?:boolean;large?:boolean;speaking?:boolean}){return <span aria-hidden="true" className={'ab-mascot'+(busy?' ab-mascot--busy':'')+(large?' ab-mascot--large':'')+(speaking?' ab-mascot--speaking':'')}><span className="ab-mascot-sprite"><span className="ab-mascot-face"/></span></span>;}
