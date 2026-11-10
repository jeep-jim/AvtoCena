import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DealerBrowsingProvider} from '../../apps/web/components/dealers/DealerBrowsingContext';
import {LazyRelatedOffers} from '../../apps/web/components/catalog/LazyRelatedOffers';

const params = new URLSearchParams(location.search);
const dealer = params.has('dealer') ? {
  id:params.get('dealer')!,name:'Тестовый дилер',logoLight:'',logoDark:'',
  href:'/nvkz/test-dealer' + (params.get('preview') === '1' ? '?preview=1' : ''),
  preview:params.get('preview') === '1',markets:[],
} : null;

function ManualNetworkControls() {
  const [state,setState]=useState<{count:number;pending:number;requests:any[]}>({count:0,pending:0,requests:[]});
  useEffect(()=>{
    let active=true;
    const refresh=()=>{void fetch('/__fixture/state').then(response=>response.json()).then(value=>{if(active)setState(value);});};
    refresh();const timer=setInterval(refresh,250);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  const respond=(mode:string)=>{void fetch('/__fixture/respond?mode='+mode,{method:'POST'});};
  return <details open className="related-fixture-network">
    <summary>Контроль ответов для проверки</summary>
    <p>Запросов похожих: <output id="fixture-request-count">{state.count}</output> · Ожидают: <output id="fixture-pending-count">{state.pending}</output></p>
    <div className="related-fixture-network-actions">
      <button disabled={!state.pending} onClick={()=>respond('partial')}>Ответ: частично</button>
      <button disabled={!state.pending} onClick={()=>respond('success')}>Ответ: успешно</button>
      <button disabled={!state.pending} onClick={()=>respond('failure')}>Ответ: ошибка 500</button>
      <button onClick={()=>{void fetch('/__fixture/reset',{method:'POST'}).then(()=>{history.scrollRestoration='manual';window.scrollTo(0,0);location.reload();});}}>Сбросить и открыть сначала</button>
    </div>
    <pre id="fixture-requests">{JSON.stringify(state.requests,null,2)}</pre>
  </details>;
}

function Fixture() {
  const [clicks,setClicks] = useState(0);
  const [note,setNote] = useState('');
  return <DealerBrowsingProvider dealer={dealer}>
    <header className="related-fixture-controls">
      <label>Заметка по автомобилю<input value={note} onChange={event=>setNote(event.target.value)} /></label>
      <button id="primary-action" onClick={()=>setClicks(value=>value+1)}>Основное действие</button>
      <output id="primary-count" aria-label="Выполнено действий">{clicks}</output>
    </header>
    <main className="related-fixture-page">
      <section style={{minHeight:2600}} data-primary-details>
        <h1>Toyota Camry · текущий автомобиль</h1>
        <p>Основные сведения и элементы управления доступны до загрузки похожих автомобилей.</p>
      </section>
      <LazyRelatedOffers id={params.get('id') || '000000000000000000000001'} catalogHref="/cars?market=china" />
    </main>
    {params.get('manual')==='1'&&<ManualNetworkControls />}
  </DealerBrowsingProvider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
