import {CrmNavigation} from './CrmNavigation';
import {hasCrmPermission,type CrmPermissions} from '@/lib/crm-permissions';
import type {AuthUser} from '@/lib/auth';
import Link from "next/link";
import { CrmThemeToggle } from "./CrmThemeToggle";
import { CrmLiveAlerts } from "./CrmLiveAlerts";
import type { ReactNode } from "react";
export function CrmShellView({title,subtitle,activeHref,user,links,avatar,children}:{title:string;subtitle:string;activeHref:string;user:{id:string;role:string;displayName:string;permissions?:CrmPermissions};links:Array<readonly [string,string]>;avatar:string;children:ReactNode}) {
 return <main className="crm-root crm-workspace min-h-screen">
  <header className="crm-header">
   <div className="crm-header-inner">
    <div className="crm-topbar">
     <Link href="/" className="crm-brand"><img src="/logo/avtocena-mark-dark.svg" className="crm-brand-mark" width={36} height={36} alt="" /><span>CRM</span></Link>
     <div className="crm-header-actions">{hasCrmPermission(user as AuthUser,"game")?<Link href="/crm/game" prefetch={false} className="crm-game-link" aria-label="Старт — игры"><span aria-hidden="true" className="crm-game-emoji">🎮</span><span className="crm-game-label">Старт</span></Link>:null}<CrmThemeToggle/><CrmLiveAlerts userId={user.id} role={user.role} displayName={user.displayName} crm avatar={avatar}/></div>
    </div>
    <CrmNavigation links={links} activeHref={activeHref} userId={user.id}/>
   </div>
  </header>
  <div className="crm-content">
   <div className="crm-page-heading"><h1>{title}</h1><details className="crm-page-help"><summary>О разделе</summary><p>{subtitle}</p></details></div>
   {children}
  </div>
 </main>;
}
