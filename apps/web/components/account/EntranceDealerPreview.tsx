'use client';
import {DealerLivePreview} from '@/components/dealers/DealerLivePreview';
import {defaultShowcase} from '@/lib/dealers/showcase-model';
const example={...defaultShowcase('entrance_example','Ваша компания'),description:'Автомобили из-за рубежа: подбор, проверка и доставка. Здесь покупатели знакомятся с вашей компанией и оставляют заявки.',catalogMarkets:['japan','china','korea'] as ReturnType<typeof defaultShowcase>['catalogMarkets'],buyersEnabled:false};
export function EntranceDealerPreview(){return <div className="entrance-dealer-preview"><p>Пример страницы вашей компании</p><DealerLivePreview value={example} section="profile" verified={false} fullAccess/></div>;}
