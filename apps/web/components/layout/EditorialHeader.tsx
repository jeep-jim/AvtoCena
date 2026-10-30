import {PublicHeader} from './PublicHeader';
import './editorial-header.css';
export function EditorialHeader({backHref,backLabel}:{backHref:string;backLabel?:string}){
 return <><PublicHeader backHref={backHref} backLabel={backLabel}/><div className="ac-editorial-header-space" aria-hidden="true"/></>;
}
