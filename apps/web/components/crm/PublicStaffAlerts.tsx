"use client";
import {useEffect,useState} from "react";
import {CrmLiveAlerts} from "./CrmLiveAlerts";
export function PublicStaffAlerts(){
 const [user,setUser]=useState<{id:string;role:string;displayName:string}|null>(null);
 useEffect(()=>{let active=true;void fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(data=>{if(active && ["owner","admin","manager"].includes(data?.user?.role))setUser(data.user);}).catch(()=>{});return()=>{active=false;};},[]);
 return user?<CrmLiveAlerts userId={user.id} role={user.role} displayName={user.displayName} header/>:null;
}
