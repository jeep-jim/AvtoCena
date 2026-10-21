'use client';
export function AutobotMascot({busy=false,large=false,speaking=false}:{busy?:boolean;large?:boolean;speaking?:boolean}){
 return <span aria-hidden="true" className={'ab-mascot'+(busy?' ab-mascot--busy':'')+(large?' ab-mascot--large':'')+(speaking?' ab-mascot--speaking':'')}><span className="ab-mascot-sprite"><svg className="ab-mascot-signs" viewBox="0 0 100 60" preserveAspectRatio="none"><rect width="100" height="60" rx="18" fill="#0b1012"/><g fill="none" strokeLinecap="round" strokeWidth="6"><path stroke="#f3f4f6" d="M20 25h20M30 15v20"/><path stroke="#f3f4f6" d="M61 25h20"/></g></svg></span></span>;
}
