'use client';
import {useEffect,useState} from 'react';
import {MessageCircle,FileText,Bell,Star,Car,Check,Pause,Play,ChevronLeft,ChevronRight,MapPin} from 'lucide-react';
import type {AccountRole} from '@/lib/account-appearance';
const scenes:Record<AccountRole,{title:string;description:string;kind:string;lines:string[]}[]>={
 customer:[
 {title:'Ваш менеджер рядом',description:'Общайтесь по своей заявке прямо в кабинете.',kind:'chat',lines:['Здравствуйте! Поможете подобрать автомобиль?','Обсудим бюджет и ваши пожелания.','Переписка с менеджером и компанией']},
 {title:'Заявка — шаг за шагом',description:'Следите за статусом обращения.',kind:'route',lines:['Заявка','Подбор','Договор','Работа']},
 {title:'Документы под рукой',description:'Прикрепляйте файлы и открывайте документы от менеджера.',kind:'docs',lines:['Ваши документы','Подписанный договор','Файлы по заявке']},
 {title:'Не пропускайте важное',description:'Новые сообщения, документы и изменения заявки.',kind:'bell',lines:['Менеджер ответил','Добавлен документ','Обновлён статус заявки']},
 {title:'Ваш опыт важен',description:'После подтверждения подписанного договора можно оценить дилера.',kind:'review',lines:['Один отзыв на заявку','После публикации отзыв нельзя изменить','Оценка на странице дилера']}],
 dealer:[
 {title:'Ваша компания на АвтоЦене',description:'Оформите профиль, направления и предложения.',kind:'cars',lines:['Профиль компании','Автомобили в наличии','Автомобили под заказ']},
 {title:'От обращения до договора',description:'Работайте с заявками в своём кабинете.',kind:'route',lines:['Обращение','Менеджер','Документы','Договор']},
 {title:'Общение с клиентом',description:'Переписка и документы рядом с заявкой.',kind:'chat',lines:['Клиент выбрал автомобиль','Уточните детали и согласуйте подбор','История общения под рукой']},
 {title:'Предложения с расчётом',description:'Укажите автомобиль, стоимость и условия доставки.',kind:'docs',lines:['Характеристики автомобиля','Стоимость и доставка','Публикация предложения']},
 {title:'Репутация компании',description:'Отзывы клиентов после подтверждённого договора.',kind:'review',lines:['Проверенная заявка','Оценка клиента','Рейтинг на странице компании']}],
 blogger:[
 {title:'Автомобили и ваш взгляд',description:'Приглашаем авторов в закрытое бета-тестирование.',kind:'cars',lines:['Обзоры автомобилей','Ваш опыт и аудитория','Обсудим формат участия']},
 {title:'Представьтесь команде',description:'В заявке расскажите о своём канале.',kind:'docs',lines:['Имя и контакт','Ссылка на канал','Темы ваших публикаций']},
 {title:'Обсудим сотрудничество',description:'Возможности кабинета уточняем с участниками беты.',kind:'chat',lines:['Расскажите о своей аудитории','Обсудим идеи и предложения','Свяжемся по контакту из заявки']},
 {title:'Начните с заявки',description:'Открытой регистрации пока нет.',kind:'route',lines:['Заявка','Рассмотрение','Обсуждение','Приглашение']}],
 supplier:[
 {title:'Автомобили для партнёров',description:'Приглашаем поставщиков в закрытое бета-тестирование.',kind:'cars',lines:['Ваши рынки','Автомобили и условия','Обсудим формат участия']},
 {title:'Расскажите о компании',description:'Укажите направления и контакт для связи.',kind:'docs',lines:['Название компании','Страны и виды поставок','Контакт представителя']},
 {title:'Согласуем условия',description:'Возможности кабинета уточняем с участниками беты.',kind:'chat',lines:['Какие автомобили вы поставляете?','Расскажите о проверке и логистике','Обсудим сотрудничество']},
 {title:'Присоединяйтесь к бете',description:'Отправьте заявку на рассмотрение команды.',kind:'route',lines:['Заявка','Рассмотрение','Обсуждение','Приглашение']}]
};
export function AccountScenes({role}:{role:AccountRole}){
 const [index,setIndex]=useState(0),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false);
 const items=scenes[role],scene=items[index%items.length];
 useEffect(()=>{setIndex(0);},[role]);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>{if(paused||reduced)return;const timer=setInterval(()=>{if(!document.hidden)setIndex(i=>(i+1)%items.length);},6500);return()=>clearInterval(timer);},[paused,reduced,items.length,role]);
 const move=(step:number)=>{setPaused(true);setIndex(i=>(i+step+items.length)%items.length);};
 const Icon=scene.kind==='chat'?MessageCircle:scene.kind==='docs'?FileText:scene.kind==='bell'?Bell:scene.kind==='review'?Star:Car;
 return <div data-paused={paused||reduced} className="account-scenes" aria-label="Возможности кабинета" aria-roledescription="карусель" onKeyDown={e=>{if(e.key==='ArrowRight')move(1);if(e.key==='ArrowLeft')move(-1);}}>
 <div className="account-scene" key={role+index} data-kind={scene.kind}>
 <span className="account-scene-example">{role==='blogger'||role==='supplier'?'Закрытая бета · планируем вместе':'Возможности кабинета · пример'}</span>
 <div className="account-scene-visual" aria-hidden="true"><Icon className="account-scene-symbol" size={38}/>
 {scene.kind==='cars'&&<svg className="account-scene-car" viewBox="0 0 340 105"><path d="M8 88H332" stroke="currentColor" strokeOpacity=".2" strokeDasharray="6 7"/><path d="M47 62L63 32Q67 24 85 24H219L253 51L292 58Q304 60 306 78H32V70Q32 63 47 62Z" fill="#ffda62"/><path d="M78 32H138V51H67ZM147 32H214L239 51H147Z" fill="#25334c"/><circle cx="86" cy="78" r="17" fill="#25334c"/><circle cx="86" cy="78" r="8" fill="#d6dde8"/><circle cx="253" cy="78" r="17" fill="#25334c"/><circle cx="253" cy="78" r="8" fill="#d6dde8"/><path d="M39 65H55M284 62H299" stroke="#fff" strokeWidth="5"/></svg>}
 {scene.kind==='review'&&<div className="account-scene-stars">{[1,2,3,4,5].map(n=><Star key={n} style={{animationDelay:`${n*.15}s`}}/>)}</div>}
 <div className={'account-scene-lines '+scene.kind}>{scene.lines.map((line,i)=><div key={line} style={{animationDelay:`${i*.2}s`}}>{scene.kind==='route'?<MapPin size={20}/>:scene.kind==='docs'?<FileText size={20}/>:scene.kind==='bell'?<Bell size={18}/>:scene.kind==='review'?<Check size={16}/>:null}<span>{line}</span></div>)}</div></div>
 <h2>{scene.title}</h2><p>{scene.description}</p></div>
 <div className="account-scene-controls"><button type="button" aria-label="Предыдущая сцена" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><div>{items.map((s,i)=><button key={s.title} type="button" aria-label={`Сцена ${i+1}: ${s.title}`} aria-pressed={index%items.length===i} onClick={()=>{setPaused(true);setIndex(i);}}>{i+1}</button>)}</div><button type="button" aria-label="Следующая сцена" onClick={()=>move(1)}><ChevronRight size={18}/></button><button type="button" aria-label={paused||reduced?'Включить смену сцен':'Остановить смену сцен'} onClick={()=>{setReduced(false);setPaused(!(paused||reduced));}}>{paused||reduced?<Play size={16}/>:<Pause size={16}/>}</button></div>
 </div>;
}
