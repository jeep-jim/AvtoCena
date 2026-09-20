"use client";
import {useEffect,useState} from "react";
import {CrmLiveAlerts} from "./CrmLiveAlerts";
export function PublicStaffAlerts(){
 const [userId,setUserId]=useState("");
 useEffect(()=>{let active=true;void fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(data=>{if(active && ["owner","admin","manager"].includes(data?.user?.role))setUserId(data.user.id);}).catch(()=>{});return()=>{active=false;};},[]);
 return userId?<CrmLiveAlerts userId={userId} floating/>:null;
}
