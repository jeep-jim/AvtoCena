import React from 'react';
import '../../apps/web/components/account/account.css';
import {createRoot} from 'react-dom/client';
import {DealerReviewCard} from '../../apps/web/components/dealers/DealerReviewCard';
import {dealerProfileStyles} from '../../apps/web/components/dealers/DealerProfileStyles';
const role=new URLSearchParams(location.search).get('role');
createRoot(document.getElementById('root')!).render(<><style>{dealerProfileStyles}</style><section className="dealer-profile" style={{maxWidth:740,margin:'20px auto'}}><section className="dealer-reviews-panel"><h2>Отзывы о Top Avto</h2><DealerReviewCard review={{id:'a'.repeat(64),author:'Стас',avatarUrl:'/avatars/customers/character-1.svg',rating:4.2,text:'Спасибо за помощь с выбором автомобиля и документами!',createdAt:'2026-10-05T00:00:00Z'}} dealerId="dealer_topavto" dealerName="Top Avto" canReply={role==='owner'||role==='dealer'} canDelete={role==='owner'} onChanged={()=>{}}/></section></section></>);
