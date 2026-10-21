import test from 'node:test';
import assert from 'node:assert/strict';
import {videoReview, videoReviews, withoutVideoLinks} from '../apps/web/lib/dealers/video-review';

test('supported public and embed links produce allowlisted players and survive saving', () => {
  const cases = [
    ['https://vkvideo.ru/video-123_456', 'https://vkvideo.ru/video_ext.php?oid=-123&id=456'],
    ['https://m.vk.com/video123_456', 'https://vkvideo.ru/video_ext.php?oid=123&id=456'],
    ['https://vk.com/videos-123?z=video-123_456%2Fclub123', 'https://vkvideo.ru/video_ext.php?oid=-123&id=456'],
    ['https://vk.ru/clip-123_456', 'https://vkvideo.ru/video_ext.php?oid=-123&id=456'],
    ['<iframe src="https://vkvideo.ru/video_ext.php?oid=-123&amp;id=456&amp;hash=abcdef12&autoplay=1" onload="alert(1)"></iframe>', 'https://vkvideo.ru/video_ext.php?oid=-123&id=456&hash=abcdef12'],
    ['https://rutube.ru/shorts/7716bd3e665725c3c008ae7ab4ff02e2/?p=abc%2Bxyz', 'https://rutube.ru/play/embed/7716bd3e665725c3c008ae7ab4ff02e2/?p=abc%2Bxyz'],
    ['https://youtube.com/live/abcdefghijk?autoplay=1', 'https://www.youtube-nocookie.com/embed/abcdefghijk'],
    ['https://www.youtube-nocookie.com/embed/abcdefghijk', 'https://www.youtube-nocookie.com/embed/abcdefghijk'],
    ['https://ok.ru/video/26870090463', 'https://ok.ru/videoembed/26870090463'],
    ['https://m.ok.ru/video/26870090463', 'https://ok.ru/videoembed/26870090463'],
    ['https://vimeo.com/76979871/abcdef1234', 'https://player.vimeo.com/video/76979871?h=abcdef1234'],
    ['https://player.vimeo.com/video/76979871?h=abcdef1234&autoplay=1', 'https://player.vimeo.com/video/76979871?h=abcdef1234'],
    ['https://kinescope.io/202589431', 'https://kinescope.io/embed/202589431'],
    ['https://dzen.ru/embed/v1l0WGUe-MAQ?autoplay=1', 'https://dzen.ru/embed/v1l0WGUe-MAQ?autoplay=0'],
    ['https://geo.dailymotion.com/player/x8lr5.html?video=x84sh87', 'https://geo.dailymotion.com/player/x8lr5.html?video=x84sh87'],
  ];
  for (const [input, embed] of cases) {
    const parsed = videoReview(input)!;
    assert.equal(parsed?.embed, embed, input);
    assert.equal(videoReview(parsed.url)?.embed, embed, 'save/reload: ' + input);
  }
});
test('unknown sites, credentials, bad IDs and private messages never become iframes', () => {
  for (const input of ['javascript:alert(1)', 'http://vk.com/video1_2', 'https://vkvideo.ru.evil.test/video1_2', 'https://vk.com@evil.test/video1_2', 'https://u:p@vk.com/video1_2', 'https://vk.com:8443/video1_2', 'https://vk.com/video_ext.php?oid=1&id=2%3Cscript%3E', 'https://youtube.com/embed/abcdefghijk/evil', 'https://example.com/embed/123', 'https://t.me/c/123/456']) assert.equal(videoReview(input), null, input);
  assert.equal(videoReview('https://dzen.ru/video/watch/1234567890abcdef12345678')?.embed, undefined);
  assert.equal(videoReview('https://max.ru/c/-123/abc')?.embed, undefined);
});
test('deduplicate player variants, retain direct file signatures and clean descriptions', () => {
  assert.equal(videoReviews('https://youtu.be/abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk').length, 1);
  assert.deepEqual(videoReview('https://media.example.com/car.mp4?signature=abc&expires=123'), {url:'https://media.example.com/car.mp4?signature=abc&expires=123',source:'media.example.com',direct:true});
  assert.equal(withoutVideoLinks('Автомобиль в наличии.\nВидеообзор VK Видео: https://vk.com/video1_2'), 'Автомобиль в наличии.');
  assert.equal(videoReviews(...Array.from({length: 8}, (_, i) => `https://ok.ru/video/${i+1}`)).length, 6);
});
