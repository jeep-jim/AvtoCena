import {Phone} from "lucide-react";
export function ContactIcon({channel}:{channel:string}){
 return channel==="call"?<Phone className="crm-phone-icon" aria-hidden="true"/>:<img src={`/brands/crm/${channel}.svg`} alt="" width={80} height={80}/>;
}
