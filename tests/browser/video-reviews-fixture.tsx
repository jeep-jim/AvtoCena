import React from 'react';
import {createRoot} from 'react-dom/client';
import {VideoReviews} from '../../apps/web/components/dealers/VideoReviews';
import {videoReviews} from '../../apps/web/lib/dealers/video-review';
const urls = ['https://vkvideo.ru/video-123_456','https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/','https://ok.ru/video/26870090463','https://vimeo.com/76979871','https://kinescope.io/202589431','https://dzen.ru/embed/v1l0WGUe-MAQ','https://youtu.be/abcdefghijk','https://geo.dailymotion.com/player/x8lr5.html?video=x84sh87','https://media.example.com/car.mp4','https://max.ru/c/-123/abc'];
createRoot(document.getElementById('root')!).render(<>{urls.map(url => <VideoReviews key={url} items={videoReviews(url)}/>)}</>);
