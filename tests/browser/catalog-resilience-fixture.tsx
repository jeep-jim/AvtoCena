import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RetainedCatalogResults} from '../../apps/web/components/catalog/RetainedCatalogResults';
function App(){
 const [filter,setFilter]=useState('Все'),[error,setError]=useState(''),[scope,setScope]=useState('public:korea'),[result,setResult]=useState('Машина 1');
 (window as any).retry=()=>{setResult('Машина 2');setError('');};
 return <><a href="/other">Другой раздел</a><label>Марка<select value={filter} onChange={e=>{setFilter(e.target.value);setError('Условия сохранены.');}}><option>Все</option><option>Hyundai</option></select></label>
 <button onClick={()=>{setScope('dealer:other');setError('Нет ответа.');}}>Другой каталог</button>
 <button onClick={()=>{setError('');setResult('Совпадений нет');}}>Пустой успешный поиск</button>
 <RetainedCatalogResults scope={scope} error={error}><article>{result}<button onClick={e=>e.currentTarget.textContent='Выбрано'}>Выбрать</button><nav className="ac-pagination"><a href="?page=2">2</a></nav><a className="ac-catalog-more">Показать ещё</a></article></RetainedCatalogResults></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
