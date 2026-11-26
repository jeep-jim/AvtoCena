import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CatalogCover} from '../../apps/web/components/catalog/CatalogCover';

type PhotoState = {src: string; shown: boolean; eager: boolean; belowFold: boolean; revision: number};
function PhotoRetryFixture() {
  const [photo, setPhoto] = useState<PhotoState>({src: '', shown: false, eager: true, belowFold: false, revision: 0});
  useEffect(() => {
    (window as any).__photoRetryFixture.configure = (next: Partial<PhotoState>) => {
      flushSync(() => setPhoto(current => ({...current, ...next, revision: current.revision + 1})));
    };
    (window as any).__photoRetryFixture.ready = true;
  }, []);
  return <main>
    <h1>Фото автомобиля</h1>
    <div style={{height: photo.belowFold ? 5000 : 0}} aria-hidden="true" />
    <div id="photo-cover" data-revision={photo.revision}>
      {photo.shown ? <CatalogCover src={photo.src} alt="Тестовый автомобиль" eager={photo.eager} /> : null}
    </div>
  </main>;
}

(window as any).__photoRetryFixture = {ready: false, errors: 0, loads: 0};
for (const event of ['error', 'load']) document.addEventListener(event, target => {
  if (target.target instanceof HTMLImageElement && target.target.closest('#photo-cover')) {
    (window as any).__photoRetryFixture[event === 'error' ? 'errors' : 'loads']++;
  }
}, true);
createRoot(document.getElementById('root')!).render(<PhotoRetryFixture />);
