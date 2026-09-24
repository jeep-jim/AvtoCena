// Real CRM pages/components, synthetic records only. No production credentials.
import React from 'react';
import {createRoot} from 'react-dom/client';
import Overview from '../../apps/web/app/(crm)/crm/page';
import Leads from '../../apps/web/app/(crm)/crm/leads/page';
import Managers from '../../apps/web/app/(crm)/crm/managers/page';
import Settings from '../../apps/web/app/(crm)/crm/settings/page';
import Clients from '../../apps/web/app/(crm)/crm/clients/page';
import Client from '../../apps/web/app/(crm)/crm/clients/[id]/page';
const pages:any={overview:Overview,leads:Leads,archive:Leads,team:Managers,settings:Settings,clients:Clients,client:Client};
async function resolve(node:any):Promise<any>{
 if(Array.isArray(node))return Promise.all(node.map(resolve));
 if(!React.isValidElement(node))return node;
 const element:any=node;
 if(typeof element.type==='function'&&element.type.constructor.name==='AsyncFunction')return resolve(await element.type(element.props));
 return React.cloneElement(element,{...element.props,children:await resolve(element.props.children)});
}
const kind=new URLSearchParams(location.search).get('kind')||(location.pathname==='/crm/clients'?'clients':location.pathname==='/crm/leads'?'leads':'overview');
void pages[kind]({searchParams:Promise.resolve({...Object.fromEntries(new URLSearchParams(location.search)),...(kind==='archive'?{view:'archive'}:{})}),params:Promise.resolve({id:"client-0"})}).then(resolve).then((tree:any)=>createRoot(document.getElementById('root')!).render(tree));
