"use client";
import Link from "next/link";
import {UserRound} from "lucide-react";
import {useEffect,useState} from "react";
import {CrmLiveAlerts} from "./CrmLiveAlerts";
export function PublicStaffAlerts(){
 const [user,setUser]=useState<{id:string;role:string;displayName:string;avatarUrl?:string}|null>(null);
 useEffect(()=>{let active=true;void fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(data=>{if(active && ["owner","admin","manager"].includes(data?.user?.role))setUser(data.user);}).catch(()=>{});return()=>{active=false;};},[]);
 return user?<CrmLiveAlerts userId={user.id} role={user.role} displayName={user.displayName} avatar={user.avatarUrl} header/>:<Link href="/account" aria-label="Личный кабинет" title="Личный кабинет" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-400/10 text-[var(--ac-text)]"><UserRound size={22}/></Link>;
}
