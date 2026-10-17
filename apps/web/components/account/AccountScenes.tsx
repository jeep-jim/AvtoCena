'use client';

import {createPortal} from 'react-dom';
import {Fragment,memo,useEffect,useMemo,useRef,useState} from 'react';
import {Pause,Play,ChevronLeft,ChevronRight} from 'lucide-react';
import type {AccountMedia, AccountRole} from '@/lib/account-appearance';
import {ACCOUNT_SCENES,sceneMarkup} from './scene-content';
import './account-scenes.css';

// Keep the injected subtree intact when hover, pause or parent headings update.
const SceneBody = memo(function SceneBody({html,kind}:{html:string;kind:string}) {
  return <div className="account-scene" data-kind={kind} dangerouslySetInnerHTML={{__html:html}}/>;
});

type Props = {controlsHost?:HTMLElement|null;role:AccountRole; media?:AccountMedia[]; onMediaOpen?:(item:AccountMedia)=>void; onSceneChange?:(index:number)=>void};
export function AccountScenes({role,onSceneChange,media=[],onMediaOpen,controlsHost}:Props) {
  const [index,setIndex]=useState(0), [paused,setPaused]=useState(false), [reduced,setReduced]=useState(false);
  const [held,setHeld]=useState(false);
  const [hovered,setHovered]=useState(false), [demoNotice,setDemoNotice]=useState('');
  const wheelLast=useRef(-Infinity);
  const manualRating=useRef<number|null>(null);
  const root=useRef<HTMLDivElement>(null), pointer=useRef<{x:number;y:number}|null>(null);
  const items=ACCOUNT_SCENES[role], scene=items[index%items.length];
  const html=useMemo(()=>sceneMarkup(scene,role),[scene,role]);
  const stopped=paused||reduced;
  const holdCarousel=stopped||hovered||held;
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{onSceneChange?.(index);setDemoNotice('');},[index,onSceneChange]);
  const autoAdvance=useRef(false);autoAdvance.current=!holdCarousel;
  const duration=[9000,8500,10000,6500,8500,6500][scene.template];

  // Animate only inside this mounted scene; every frame is cancelled on switch/unmount.
  const running=useRef(false);running.current=!stopped;
  const reducedRef=useRef(reduced);reducedRef.current=reduced;
  useEffect(()=>{
    const node=root.current;if(!node)return;manualRating.current=null;
    const get=(id:string)=>node.querySelector<HTMLElement>(`[data-demo-id="${id}"]`);
    let frame=0, elapsed=0, previous=0;
    const map=get('trackMap'), car=get('trackTruck');
    let routeStops:number[]=[], noticeStep=90;
    const measure=()=>{
      if(map){const bounds=map.getBoundingClientRect();routeStops=Array.from(map.querySelectorAll<HTMLElement>('.track-point-wrap'),point=>{const box=point.getBoundingClientRect();return box.left-bounds.left+box.width/2;});}
      const notices=node.querySelectorAll<HTMLElement>('.notif-item');if(notices.length>1)noticeStep=notices[1].offsetTop-notices[0].offsetTop;
    };
    const resize=new ResizeObserver(measure);resize.observe(node);measure();
    const lines=node.querySelectorAll('.contract-viewer-line');
    const toggle=(id:string,name:string,on:boolean)=>get(id)?.classList.toggle(name,on);
    const signature=node.querySelector<SVGPathElement>('.contract-signature path');
    const signatureLength=signature?.getTotalLength()||1;
    if(signature){signature.style.strokeDasharray=String(signatureLength);signature.style.strokeDashoffset=String(signatureLength);}
    const tick=(now:number)=>{
      if(previous&&running.current&&!document.hidden)elapsed+=Math.min(now-previous,100);
      previous=now;
      const time=reducedRef.current?10000:elapsed;
      if(scene.template===0){
        const count=reducedRef.current?6:Math.min(6,3+Math.floor(time/2000));
        node.querySelectorAll<HTMLElement>('.chat-msg').forEach((message,i)=>message.classList.toggle('is-visible',i<count&&i>=Math.max(0,count-3)));
        const typing=node.querySelector<HTMLElement>('.chat-typing');if(typing)typing.style.visibility=count===6?'hidden':'visible';
      }
      if(scene.template===1){
        const finished=time>=6500;
        toggle('contractIntro','is-hidden',time>=2300&&!finished);
        toggle('contractViewer','is-active',time>=2300&&!finished);
        get('sceneContract')?.classList.toggle('is-complete',finished);
        lines.forEach((line,i)=>line.classList.toggle('is-visible',time>=2500+i*110));
        const progress=Math.max(0,Math.min(1,(time-3750)/650));
        if(signature)signature.style.strokeDashoffset=String(signatureLength*(1-progress));
        toggle('contractSignature','is-signing',progress>0);
        toggle('contractConfirmCheck','is-visible',time>=4600);
        toggle('contractStatus','is-visible',finished);
        const hint=get('contractSignHint');if(hint)hint.textContent=time>=4600?'Подписано':time>=3750?'Подписание…':'Ожидание подписи…';
      }
      if(scene.template===2){
        // Dwell at every checkpoint; all five stops share the same clock.
        const leg=Math.min(4,Math.floor(time/2200));
        const fraction=leg===4?0:Math.max(0,Math.min(1,(time%2200-850)/1350));
        const position=(routeStops[leg]||0)+((routeStops[Math.min(4,leg+1)]||0)-(routeStops[leg]||0))*fraction;
        if(car)car.style.left=`${position}px`;
        const labels=['Автомобиль готов к отправке','Фрахт · перевозка морем','Автомобиль поступил на СВХ','Таможенное оформление','Автомобиль прибыл в Москву'];
        const arrival=get('trackArrival');if(arrival){arrival.textContent=labels[leg];arrival.classList.add('is-visible');}
        node.querySelectorAll<HTMLElement>('.track-point-wrap').forEach((point,i)=>{point.classList.toggle('is-active',i===leg);point.classList.toggle('is-done',i<leg);});
        node.querySelectorAll<HTMLElement>('.track-segment').forEach((segment,i)=>{segment.classList.toggle('is-done',i<leg);segment.classList.toggle('is-active',i===leg);segment.classList.toggle('is-future',i>leg);segment.style.setProperty('--route-progress',`${fraction*100}%`);});
        const stats=node.querySelectorAll('.track-stat-val');
        if(stats[0])stats[0].textContent=`${Math.round((leg+fraction)*25)}%`;
        if(stats[1])stats[1].textContent=leg===4?'Прибыл':`${12-leg*3} дн.`;
        if(stats[2])stats[2].textContent=['Осака','Фрахт','Владивосток','Таможня','Москва'][leg];
      }
      if(scene.template===4){
        const shift=reducedRef.current?2:Math.min(2,Math.floor(time/3300));
        const stream=get('notificationStream');if(stream)stream.style.transform=`translateY(${-shift*noticeStep}px)`;
        const badge=node.querySelector('.notif-bell-badge');if(badge)badge.textContent=String(3+shift);
      }
      if(scene.template===5){
        const rating=manualRating.current??(reducedRef.current?5:Math.min(5,Math.floor(time/700)));
        node.querySelectorAll<HTMLElement>('.review-star').forEach((star,i)=>{star.classList.toggle('is-filled',i<rating);star.setAttribute('aria-pressed',String(i<rating));});
        const label=get('reviewRating');if(label)label.textContent=rating+',0';
      }
      const drop=node.querySelector<HTMLElement>('.step-connector.is-active .step-drop');
      if(drop)drop.style.left=`${Math.min(1,time/duration)*100}%`;
      if(time>=duration&&autoAdvance.current&&!document.hidden){
        if(index<items.length-1)setIndex(index+1);else setPaused(true);
        return;
      }
      if(!reducedRef.current)frame=requestAnimationFrame(tick);
    };
    tick(performance.now());return()=>{cancelAnimationFrame(frame);resize.disconnect();};
  },[html,scene.template,reduced,index,items.length,duration]);

  useEffect(()=>{
    const node=root.current;if(!node)return;
    let total=0;
    const wheel=(event:WheelEvent)=>{
      if(!matchMedia('(min-width: 761px) and (pointer: fine)').matches||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
      const step=event.deltaY>0?1:-1;
      if((index===0&&step<0)||(index===items.length-1&&step>0))return;
      event.preventDefault();
      const now=performance.now();if(now-wheelLast.current<850)return;
      total+=event.deltaY*(event.deltaMode===1?16:1);
      if(Math.abs(total)<45)return;
      wheelLast.current=now;total=0;setHeld(false);setIndex(i=>Math.max(0,Math.min(items.length-1,i+step)));
    };
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[index,items.length]);
  useEffect(()=>{
    if(scene.template!==3)return;
    const tiles=root.current?.querySelectorAll<HTMLElement>('.media-tile');
    tiles?.forEach((tile,i)=>{
      const item=media[i];tile.hidden=media.length>0&&!item;if(!item)return;
      tile.setAttribute('role','button');tile.tabIndex=0;tile.setAttribute('aria-label',item.caption||`Открыть ${item.type==='video'?'видео':'фото'} ${i+1}`);
      const badge=tile.querySelector('.media-tile-badge');if(badge)badge.textContent=String(i+1);
      if(item.type==='image'){const img=document.createElement('img');img.src=item.url;img.alt=item.caption;img.className='account-media-thumbnail';tile.prepend(img);}
      else {tile.classList.add('media-tile--video');tile.setAttribute('data-video','true');
        const video=document.createElement('video');video.src=item.url;video.muted=true;video.playsInline=true;video.preload='metadata';video.className='account-media-thumbnail';video.setAttribute('aria-hidden','true');
        video.addEventListener('loadedmetadata',()=>{if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Math.min(.1,video.duration/2);},{once:true});tile.prepend(video);
      }
    });
    const open=(target:EventTarget|null)=>{const tile=(target as HTMLElement)?.closest('.media-tile');if(!tile||!tiles)return;const i=Array.from(tiles).indexOf(tile as HTMLElement);if(media[i]){setHeld(true);onMediaOpen?.(media[i]);}};
    const click=(e:MouseEvent)=>open(e.target);
    const key=(e:KeyboardEvent)=>{if((e.key==='Enter'||e.key===' ')&&(e.target as HTMLElement).matches('.media-tile[role=button]')){e.preventDefault();open(e.target);}};
    const node=root.current;node?.addEventListener('click',click);node?.addEventListener('keydown',key);
    return()=>{node?.removeEventListener('click',click);node?.removeEventListener('keydown',key);tiles?.forEach(t=>{const preview=t.querySelector('.account-media-thumbnail');if(preview instanceof HTMLVideoElement){preview.pause();preview.removeAttribute('src');preview.load();}preview?.remove();t.hidden=false;t.removeAttribute('role');t.removeAttribute('tabindex');t.removeAttribute('aria-label');t.removeAttribute('data-video');});};
  },[html,media,onMediaOpen,scene.template]);
  function move(step:number){setHeld(false);setIndex(i=>(i+step+items.length)%items.length);}
  const player=<div className="scene-navigation"><button type="button" aria-label="Предыдущая сцена" onClick={()=>move(-1)}><ChevronLeft size={15}/></button><button type="button" aria-label={paused||reduced?'Включить смену сцен':'Остановить смену сцен'} onClick={()=>{if((paused||reduced)&&index===items.length-1)setIndex(0);setReduced(false);setHeld(false);setPaused(!(paused||reduced));}}>{paused||reduced?<Play size={13}/>:<Pause size={13}/>}</button><button type="button" aria-label="Следующая сцена" onClick={()=>move(1)}><ChevronRight size={15}/></button></div>;
  return <div ref={root} className="account-scenes" data-role={role} data-paused={stopped} data-reduced={reduced} aria-label="Возможности кабинета" aria-roledescription="карусель"
    onMouseEnter={()=>{if(matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)').matches)setHovered(true);}} onMouseLeave={()=>setHovered(false)}
    onKeyDown={e=>{if((e.target as HTMLElement).matches('input,textarea'))return;if(e.key==='ArrowRight'){e.preventDefault();move(1);}if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}}}>
    <div className="demo-stage" onPointerDown={e=>{pointer.current={x:e.clientX,y:e.clientY};}} onPointerUp={e=>{const start=pointer.current;pointer.current=null;if(start&&Math.abs(e.clientX-start.x)>50&&Math.abs(e.clientX-start.x)>Math.abs(e.clientY-start.y)*1.4)move(e.clientX<start.x?1:-1);}} onPointerCancel={()=>{pointer.current=null;}}>
      <div className="scene-event-layer" onClick={e=>{
        const target=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!target)return;
        if(target.dataset.star){const value=Number(target.dataset.star);manualRating.current=value;const label=root.current?.querySelector('[data-demo-id="reviewRating"]');if(label)label.textContent=value+',0';root.current?.querySelectorAll<HTMLElement>('.review-star').forEach((star,i)=>{star.classList.toggle('is-filled',i<value);star.setAttribute('aria-pressed',String(i<value));});setHeld(true);}
        else if(target.classList.contains('review-tag')){target.classList.toggle('is-active');target.setAttribute('aria-pressed',String(target.classList.contains('is-active')));setHeld(true);}
        else if(target.classList.contains('chat-chip')){setHeld(true);setDemoNotice(role==='blogger'||role==='supplier'?'Расскажите о себе в форме заявки рядом.':'Войдите в кабинет, чтобы открыть свою переписку и документы.');}
      }}><SceneBody key={role+index} html={html} kind={['chat','contract','route','docs','bell','review'][scene.template]}/></div>
    </div>
    <div className="account-scene-controls">
      <div className="steps-bar">{items.map((item,i)=><Fragment key={item.title}>
        <button type="button" className={`step-node${i===index?' is-active':i<index?' is-done':''}`} aria-label={`Сцена ${i+1}: ${item.title}`} aria-pressed={i===index} onClick={()=>{setHeld(false);setIndex(i);}}>{i+1}</button>
        {i<items.length-1&&<div className={`step-connector${i<index?' is-done':i===index?' is-active':''}`}><div className="step-drop"/></div>}
      </Fragment>)}</div>
      {player}
      {controlsHost&&createPortal(player,controlsHost)}
    </div>
    {demoNotice&&<div className="scene-notice" role="status">{demoNotice}<button type="button" aria-label="Закрыть подсказку" onClick={()=>setDemoNotice('')}>×</button></div>}
  </div>;
}
