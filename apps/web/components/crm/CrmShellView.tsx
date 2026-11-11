import {CrmWorkspaceFrame,CrmPageHeading} from './CrmWorkspaceFrame';
import {Gamepad2} from 'lucide-react';

import {CrmNavigation} from './CrmNavigation';
import {hasCrmPermission,type CrmPermissions} from '@/lib/crm-permissions';
import type {AuthUser} from '@/lib/auth';
import Link from "next/link";
import { CrmThemeToggle } from "./CrmThemeToggle";
import { CrmLiveAlerts } from "./CrmLiveAlerts";
import type { ReactNode } from "react";
export function CrmShellView({title,subtitle,activeHref,user,links,avatar,children}:{title:string;subtitle:string;activeHref:string;user:{id:string;role:string;displayName:string;permissions?:CrmPermissions};links:Array<readonly [string,string]>;avatar:string;children:ReactNode}) {
 return <CrmWorkspaceFrame actions={<>{hasCrmPermission(user as AuthUser,"game")?<Link href="/crm/game" prefetch={false} className="crm-game-link crm-header-game" aria-label="Старт — игры"><Gamepad2 size={20} aria-hidden="true"/><span className="crm-game-label">Старт</span></Link>:null}<CrmThemeToggle/><CrmLiveAlerts userId={user.id} role={user.role} displayName={user.displayName} crm canCreateSelection={hasCrmPermission(user as AuthUser,"dealers")} avatar={avatar}/></>} navigation={<CrmNavigation links={links} activeHref={activeHref} userId={user.id}/>}><CrmPageHeading title={title} help={subtitle}/>{children}</CrmWorkspaceFrame>;
}
