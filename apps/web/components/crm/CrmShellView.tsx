import Link from "next/link";
import { CrmThemeToggle } from "./CrmThemeToggle";
import { CrmLiveAlerts } from "./CrmLiveAlerts";
import type { ReactNode } from "react";
const shortLabels:Record<string,string>={"Команда и права":"Команда","Рынки и расчёт":"Рынки"};
export function CrmShellView({title,subtitle,activeHref,user,links,avatar,children}:{title:string;subtitle:string;activeHref:string;user:{id:string;role:string;displayName:string};links:Array<readonly [string,string]>;avatar:string;children:ReactNode}) {
 return <main className="crm-root crm-workspace min-h-screen">
  <header className="crm-header">
   <div className="crm-header-inner">
    <div className="crm-topbar">
     <Link href="/" className="crm-brand"><span className="crm-brand-mark">AC</span><span>АвтоЦена <small>CRM</small></span></Link>
     <div className="crm-header-actions"><CrmThemeToggle/><CrmLiveAlerts userId={user.id} role={user.role} displayName={user.displayName} crm avatar={avatar}/></div>
    </div>
    <nav className="crm-navigation" aria-label="Разделы CRM">{links.map(([href,label])=><Link key={href} href={href} aria-label={label} aria-current={href===activeHref?"page":undefined}>{shortLabels[label]||label}</Link>)}{links.some(([href])=>href==="/crm/telegram")?<button type="button" className="crm-documents-button" aria-disabled="true" title="Раздел документов — подключим позже">Документы</button>:null}</nav>
   </div>
  </header>
  <div className="crm-content">
   <div className="crm-page-heading"><h1>{title}</h1><details className="crm-page-help"><summary>О разделе</summary><p>{subtitle}</p></details></div>
   {children}
  </div>
 </main>;
}
