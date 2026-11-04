import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealerCabinetNavigation} from '../../apps/web/components/dealers/DealerCabinetNavigation';
import {CopyDealerLink} from '../../apps/web/components/dealers/CopyDealerLink';
import {DealerPersonalProfile} from '../../apps/web/components/dealers/DealerPersonalProfile';
import {DealerTeam} from '../../apps/web/components/dealers/DealerTeam';
import {StartDealerSelection} from '../../apps/web/components/dealers/StartDealerSelection';
const owner=new URLSearchParams(location.search).get('owner')==='1';
createRoot(document.getElementById('root')!).render(<div className="dealer-cabinet-shell"><DealerCabinetNavigation newLeads={2}/><main className="dealer-cabinet-content"><h1 className="dealer-cabinet-title">Кабинет</h1><CopyDealerLink url="https://avtocena.com/dealers/test"/><div className="my-5"><StartDealerSelection dealerId="dealer_test" href="/dealers/test"/></div><DealerPersonalProfile name="Тестовый сотрудник" phone=""/><h2 className="my-5 text-xl font-bold">Сотрудники</h2><DealerTeam self="owner" owner={owner} users={[{id:'owner',name:'Владелец',login:'owner',owner:true,disabled:false,approved:true},{id:'staff',name:'Сотрудник',login:'staff',owner:false,disabled:false,approved:true}]}/></main></div>);
