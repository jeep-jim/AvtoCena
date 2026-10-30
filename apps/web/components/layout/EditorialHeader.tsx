import {PublicHeader} from './PublicHeader';
import './editorial-header.css';
export function EditorialHeader({backHref,backLabel}:{backHref:string;backLabel?:string}){
 return <><div className="ac-page-copy" style={{display:"contents"}}><PublicHeader backHref={backHref} backLabel={backLabel}/></div><div className="ac-editorial-header-space" aria-hidden="true"/></>;
}
