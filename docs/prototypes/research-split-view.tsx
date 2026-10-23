import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ResearchSplitView} from '../../apps/web/components/research/ResearchSplitView';
import './research-split-view.css';

function Preview(){
 const [open,setOpen]=useState(false),[attempt,setAttempt]=useState(false);
 return <ResearchSplitView open={open} onClose={()=>setOpen(false)} title="Помощник по автомобилю" panel={<>
   <div className="prototype-status">Прототип интерфейса · ИИ не подключён</div>
   <div className="vehicle-context"><span>Вопрос по автомобилю</span><strong>Honda Stepwgn · 2026</strong><p>Характеристики двигателя, мощность, объём и тип топлива. Рынок Японии.</p></div>
   {attempt?<><div className="embed-note">Попытка открыть настоящий сайт Алисы. Его политика запрещает встраивание с нашего домена — браузер может показать отказ.</div><iframe title="Проверка встраивания настоящей Алисы" src="https://alice.yandex.ru/" referrerPolicy="strict-origin-when-cross-origin" className="alice-test-frame"/><button className="reset-attempt" onClick={()=>setAttempt(false)}>Вернуться к прототипу</button></>:<div className="panel-empty"><span className="large-spark">✦</span><h3>Чат рядом с автомобилем</h3><p>Карточка остаётся слева. Ширину панели можно менять, потянув границу.</p><button className="try-embed" onClick={()=>setAttempt(true)}>Проверить встраивание Алисы</button><small>Это реальная попытка загрузить alice.yandex.ru. Ответы ИИ здесь не имитируются.</small></div>}
   {!attempt&&<div className="composer-preview"><label htmlFor="preview-question">Вопрос об автомобиле</label><div><input id="preview-question" disabled placeholder="Для переписки нужен подключённый чат"/><button disabled aria-label="Отправка недоступна">↑</button></div></div>}
 </>}>
  <nav className="demo-nav"><a href="https://avtocena.com" className="wordmark">Авто<span>Цена</span><small>АВТО НА ЗАКАЗ</small></a><div>Каталог <span>Избранное</span></div><span className="demo-badge">Проверка нового интерфейса</span></nav>
  <main className="demo-main"><div className="breadcrumb">Каталог / Япония / Зелёный угол</div><div className="title-row"><div><span className="stock-tag">Зелёный угол</span><h1>Honda Stepwgn</h1><p>2026 · 7 мест · Япония</p></div><button className="heart" aria-label="Демонстрационный элемент избранного" disabled>♡</button></div>
  <div className="offer-grid"><section className="gallery"><img alt="Honda Stepwgn из проверенной карточки Зелёного угла" src="https://img.akebono.world/45f37f6d-b60f-4acf-ba7d-cdb254d6933a.JPG"/><div className="photo-caption">Пример карточки из проверки фида 25.09.2026</div></section>
   <section className="price-card"><div className="muted">Расчёт до Новокузнецка</div><div className="price">3 347 658 <span>₽</span></div><p className="price-note">Цена из проверенного снимка фида. Прототип не обновляет расчёт.</p><div className="mini-spec"><span>Год выпуска<strong>2026</strong></span><span>Рынок<strong>Япония</strong></span></div><button className="research-trigger" onClick={()=>setOpen(true)}><span aria-hidden="true">✦</span>Уточнить характеристики с ИИ</button><p className="button-note">Открыть панель справа в этой же вкладке</p><a className="car-link" href="https://avtocena.com/cars/offer/honda-stepwgn-7seats-2026--green-704052?direct=novokuznetsk">Настоящая карточка автомобиля ↗</a></section>
  </div><section className="demo-description"><h2>Автомобиль и помощник — на одном экране</h2><p>Нажмите кнопку «Уточнить характеристики с ИИ». Панель открывается внутри страницы. Перетащите разделитель; двойной щелчок возвращает стандартную ширину. С клавиатуры: Tab до разделителя, затем ← или →.</p><p className="muted">Это проверяемый прототип вёрстки. Бесплатная Алиса пока не встроена: реальная попытка доступна внутри панели.</p></section></main>
 </ResearchSplitView>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
