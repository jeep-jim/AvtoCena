'use client';
import {useState} from 'react';
import {Star} from 'lucide-react';
export function CustomerReviews({client,onSubmit}:{client:any;onSubmit:(body:any)=>Promise<unknown>}){
 return <section className="customer-reviews"><div className="review-welcome"><div className="review-brand"><span>{client.dealer?.name||'Ваш отзыв'}</span><span className="review-overall"><Star fill="currentColor" size={22}/>{client.reviewSummary?.rating?.toFixed(1)||'—'}<small>{client.reviewSummary?.count?`Оценок: ${client.reviewSummary.count}`:'Оценок пока нет'}</small></span></div><h2>Здравствуйте!</h2><p>Спасибо, что выбираете нас!</p><p>Нам важно ваше мнение. Расскажите о своём опыте — ваш отзыв поможет другим клиентам выбрать компанию, а нам — улучшить работу.</p></div>
 {client.reviews?.map((r:any)=><article className="review-published" key={r.id}><strong>{r.rating.toFixed(1)} ★ · {r.status==='published'?'Спасибо! Ваш отзыв опубликован':'Отзыв удалён модератором'}</strong><p>{r.text}</p>{r.reply&&<div className="customer-review-reply"><strong>Ответ компании</strong><p>{r.reply.text}</p></div>}</article>)}
 {client.leads.filter((l:any)=>l.canReview).map((lead:any)=><ReviewForm key={lead.id} lead={lead} onSubmit={body=>onSubmit({...body,action:'review',key:client.key,leadId:lead.id})}/>)}
 {!client.leads.some((l:any)=>l.canReview)&&!client.reviews?.length&&<p className="review-eligibility">Оставить отзыв можно после подтверждения подписанного договора. На одну заявку доступен один отзыв.</p>}
 </section>;
}
function ReviewForm({lead,onSubmit}:{lead:any;onSubmit:(body:any)=>Promise<unknown>}){
 const [rating,setRating]=useState<number|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="customer-review-form" onSubmit={async e=>{e.preventDefault();if(busy)return;if(rating===null){setError('Выберите оценку.');return;}if(!confirm('Опубликовать отзыв? После публикации изменить его нельзя.'))return;setBusy(true);setError('');try{await onSubmit({rating,text});}catch(e){setError(e instanceof Error?e.message:'Не удалось отправить отзыв. Попробуйте ещё раз.');}finally{setBusy(false);}}}>
 <div className="review-form-heading"><span>Ваш опыт важен</span><small>{lead.title}</small></div>
 <div className="review-score-row"><output className="review-score" aria-label="Ваша оценка">{rating?.toFixed(1)||'—'}</output><div><p>Ваша оценка повлияет на общий рейтинг компании</p><div className="review-stars" role="group" aria-label="Выберите оценку">{[1,2,3,4,5].map(n=><button key={n} type="button" aria-label={`Оценка ${n}`} aria-pressed={rating===n} disabled={busy} onClick={()=>setRating(n)}><Star className="review-star-empty"/><span style={{width:`${Math.max(0,Math.min(1,(rating||0)-n+1))*100}%`}}><Star fill="currentColor"/></span></button>)}</div></div></div>
 <label className="review-range-label">Поставьте оценку, перемещая ползунок<input aria-label="Оценка от 1 до 5" type="range" min="1" max="5" step="0.1" value={rating??3} onChange={e=>setRating(Number(e.target.value))} disabled={busy}/></label><div className="review-scale" aria-hidden="true"><span>Плохо</span><span>Нормально</span><span>Хорошо</span><span>Отлично</span></div>
 <label className="review-text-label">Что вам запомнилось?<textarea aria-label="Отзыв о дилере" value={text} onChange={e=>setText(e.target.value)} required minLength={10} maxLength={3000} disabled={busy} placeholder="Расскажите, что понравилось и что можно улучшить…"/></label>
 <div className="review-prompts">{['Доставка','Стоимость','Документы','Работа менеджера'].map(topic=><button type="button" key={topic} disabled={busy} onClick={()=>setText(v=>(v+(v?'\n':'')+topic+': ').slice(0,3000))}>{topic}</button>)}</div>
 <p className="review-note">После публикации отзыв и оценку нельзя изменить или удалить самостоятельно.</p>{error&&<p role="alert" className="account-error">{error}</p>}<button className="account-primary" disabled={busy}>{busy?'Публикуем…':'Опубликовать отзыв'}</button>
 </form>;
}
