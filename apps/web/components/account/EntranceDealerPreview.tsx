'use client';
import {DealerLivePreview,type PublishedDealerPreview} from '@/components/dealers/DealerLivePreview';
export function EntranceDealerPreview({dealer}:{dealer?:PublishedDealerPreview}){return <div className="entrance-dealer-preview">{dealer?<DealerLivePreview published={dealer} pageScroll section="profile" verified={dealer.verified===true} fullAccess/>:<a href="/nvkz/topavto">Открыть ТопАвто →</a>}</div>;}
