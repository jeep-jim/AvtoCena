import Link from 'next/link';
import type {ReactNode} from 'react';
export function CrmPageHeading({title,help}:{title:string;help?:string}){return <div className="crm-page-heading"><h1>{title}</h1>{help&&<details className="crm-page-help"><summary>О разделе</summary><p>{help}</p></details>}</div>;}
export function CrmWorkspaceFrame({actions,navigation,children}:{actions:ReactNode;navigation:ReactNode;children:ReactNode}){
 return <main className="crm-root crm-workspace min-h-screen"><header className="crm-header"><div className="crm-header-inner"><div className="crm-topbar"><Link href="/" className="crm-brand"><img src="/logo/avtocena-mark-dark.svg" className="crm-brand-mark" width={36} height={36} alt=""/><span>CRM</span></Link><div className="crm-header-actions">{actions}</div></div>{navigation}</div></header><div className="crm-content">{children}</div></main>;
}
export function CrmMetricCards({items}:{items:{label:string;value:number}[]}){return <div className="crm-metrics grid grid-cols-2 gap-3 md:grid-cols-4">{items.map(item=><div key={item.label} className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">{item.label}</div><div className="mt-2 text-4xl font-black">{item.value}</div></div>)}</div>;}
