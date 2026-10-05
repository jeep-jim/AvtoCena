'use client';
import {useState} from 'react';
import {ExternalLink, VideoOff} from 'lucide-react';
import type {VideoReview} from '@/lib/dealers/video-review';

function VideoCard({item}: {item: VideoReview}) {
  const [failed, setFailed] = useState(false);
  return <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)]">
    {item.embed ? <iframe className="aspect-video w-full border-0 bg-black" src={item.embed}
      loading="lazy" title={`Видеообзор · ${item.source}`} allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
      : item.direct && !failed ? <video src={item.url} controls playsInline preload="metadata"
        onError={() => setFailed(true)} className="aspect-video max-h-[520px] w-full bg-black object-contain"/>
      : <div className="flex items-center gap-3 p-4 text-sm text-[var(--ac-muted)]"><VideoOff size={22} className="shrink-0"/>
        <p>{failed ? 'Не удалось загрузить видео. Попробуйте открыть его по ссылке.' : `Видео доступно на ${item.source}. Откройте его по ссылке ниже.`}</p></div>}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
      <a className="inline-flex min-h-11 items-center gap-2 text-sm font-bold underline underline-offset-4" href={item.url} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={17} className="shrink-0"/>{item.direct ? 'Открыть видео' : `Открыть на ${item.source}`}</a>
      {item.embed && <span className="text-xs text-[var(--ac-muted)]">Не запускается? Откройте на площадке.</span>}
    </div>
  </div>;
}
export function VideoReviews({items}: {items: VideoReview[]}) {
  if (!items.length) return null;
  return <section className="mt-6 min-w-0" aria-label="Видеообзор автомобиля">
    <h2 className="text-xl font-bold">Видеообзор</h2>
    {items.map(item => <VideoCard key={item.embed || item.url} item={item}/>)}
  </section>;
}
