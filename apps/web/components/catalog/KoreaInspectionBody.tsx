import {koreaBodyParts,koreaBodyConditions,type KoreaBodyInspection} from '../../lib/catalog/korea-inspection-schema';

/** Local SVG and translated labels only: no foreign frames, scripts or images. */
export function KoreaInspectionBody({body}:{body:KoreaBodyInspection}){
 const marked=body.parts.filter(part=>part.conditions.length);
 return <section className="mt-5 min-w-0" aria-label="Схема кузова по осмотру" data-korea-body>
  <h3 className="text-base font-bold">Кузов и силовые элементы</h3>
  <p className="mt-1 text-xs leading-5 text-[var(--ac-muted)]">Отметки из документа осмотра. Слева и справа — по ходу движения автомобиля.</p>
  <div className="mt-3 grid grid-cols-2 gap-3">
   {(['outer','frame'] as const).map(group=><figure key={group} className="min-w-0 rounded-xl bg-[var(--ac-surface-2)] p-2">
    <figcaption className="text-center text-xs font-bold">{group==='outer'?'Наружные панели':'Силовые элементы'}</figcaption>
    <svg viewBox="0 0 200 278" className="mx-auto mt-2 w-full max-w-56" role="img" aria-label={group==='outer'?'Схема наружных панелей':'Схема силовых элементов'}>
     <text x="100" y="10" textAnchor="middle" fill="var(--ac-muted)" fontSize="8">ПЕРЕД</text>
     <path d="M58 24 Q100 14 142 24 L158 62 L158 216 Q154 250 135 254 L65 254 Q46 250 42 216 L42 62 Z" fill="none" stroke="var(--ac-muted)" strokeWidth="2"/>
     <path d="M59 88 L141 88 L132 110 L68 110 Z M69 183 L131 183 L142 207 L58 207 Z" fill="none" stroke="var(--ac-border)" strokeWidth="2"/>
     <rect x="68" y="114" width="64" height="65" rx="8" fill="none" stroke="var(--ac-border)" strokeWidth="2"/>
     <path d="M42 112 H67 M42 159 H67 M133 112 H158 M133 159 H158" fill="none" stroke="var(--ac-border)" strokeWidth="2"/>
     {body.parts.filter(p=>koreaBodyParts[p.key][1]===group).map(part=>{
      const [label,,x,y]=koreaBodyParts[part.key],index=marked.findIndex(p=>p.key===part.key),active=part.conditions.length>0;
      return <g key={part.key} data-body-part={part.key} data-marked={active?'true':'false'}>
       <title>{label}: {active?part.conditions.map(c=>koreaBodyConditions[c]).join(', '):'Нет отметки в документе'}</title>
       <circle cx={x} cy={y} r={active?10:3} fill={active?'#ff353d':'var(--ac-border)'} stroke={active?'var(--ac-text)':'none'} strokeWidth="1"/>
       {active&&<text x={x} y={y+3} textAnchor="middle" fontSize="10" fontWeight="700" fill="white">{index+1}</text>}
      </g>;
     })}
     <text x="100" y="273" textAnchor="middle" fill="var(--ac-muted)" fontSize="8">ЗАД</text>
    </svg>
   </figure>)}
  </div>
  {marked.length?<ol className="mt-3 space-y-2">{marked.map((part,index)=><li key={part.key} className="flex min-w-0 gap-3 rounded-xl border border-[var(--ac-border)] p-3 text-sm">
   <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ff353d] text-xs font-bold text-white">{index+1}</span>
   <div className="min-w-0"><p className="font-bold">{koreaBodyParts[part.key][0]}</p><p className="mt-1">{part.conditions.map(c=>koreaBodyConditions[c]).join(' · ')}</p></div>
  </li>)}</ol>:<p className="mt-3 text-sm">На доступной схеме отметок не обнаружено.</p>}
  <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">Серые точки означают отсутствие отметки в документе, а не подтверждённое отсутствие повреждений. Схема условная.{body.unmapped?' Часть обозначений пока не расшифрована.':''}</p>
 </section>;
}
