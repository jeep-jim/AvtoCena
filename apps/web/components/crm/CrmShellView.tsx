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
     <Link href="/" className="crm-brand"><img src="/logo/avtocena-mark-dark.svg" className="crm-brand-mark" width={36} height={36} alt="" /><span>АвтоЦена <small>CRM</small></span></Link>
     <div className="crm-header-actions"><CrmThemeToggle/><CrmLiveAlerts userId={user.id} role={user.role} displayName={user.displayName} crm avatar={avatar}/></div>
    </div>
    <nav className="crm-navigation" aria-label="Разделы CRM">{links.map(([href,label])=><Link key={href} href={href} className={href==="/crm/documents"?"crm-documents-button":undefined} aria-label={label} aria-current={href===activeHref?"page":undefined}>{shortLabels[label]||label}</Link>)}</nav>
   </div>
  </header>
  <div className="crm-content">
   <div className="crm-page-heading"><h1>{title}</h1><details className="crm-page-help"><summary>О разделе</summary><p>{subtitle}</p></details></div>
   {children}
  </div>
 </main>;
}
