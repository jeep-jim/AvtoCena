import React from 'react';
import {createRoot} from 'react-dom/client';
import {InlineOfferParameters} from '../../apps/web/components/catalog/InlineOfferParameters';
import {PriceTrend} from '../../apps/web/components/catalog/PriceTrend';

const params=new URLSearchParams(location.search);
const pinned=params.get('pinned')!=='0';
const city='Новокузнецк';
const price=1500123;
const initial:Record<string,string>={
  year:'2026',engineCc:'1998',fuel:'petrol',powerHp:'150',powerKw:'110',
  vehicleCategory:'M1',productionMonth:'',productionDay:'',hybridKind:'combustion',
  power30MinKw:'',icePowerKw:'',grossVehicleWeightKg:'',deliveryCity:city
};
const savedRate={currency:'CNY',effectiveRate:12,rateDate:'2026-11-24',rateSource:'cbr',sourcePrice:78000};
function App(){
  return <main className="ac-offer-page" data-offer-id="fixture-china">
    <InlineOfferParameters offerId="fixture-china" initial={initial} deliveryMarket="china"
      preparedChinaCityContext={pinned} initialCurrencyRate={savedRate}
      price={<PriceTrend panel className="ac-offer-price-panel" label="Ориентир без доставки" offer={{
        market:'china',totalRub:price,sourcePrice:78000,sourceCurrency:'CNY',
        calculationSnapshot:{currencyRate:savedRate}
      }}/>}
    >
      <div>Карточка автомобиля из принятого поколения</div>
    </InlineOfferParameters>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
