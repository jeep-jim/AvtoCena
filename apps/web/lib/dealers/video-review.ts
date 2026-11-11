export type VideoReview = {url: string; source: string; embed?: string; direct?: boolean};

// Accept links and copied iframe code, but never retain or execute supplied HTML.
function links(value: string): string[] {
  return value.match(/https?:\/\/[^\s<>"']+/gi) || [];
}
export function videoReview(value: unknown): VideoReview | null {
  if (typeof value !== 'string') return null;
  const candidate = links(value)[0]?.replace(/[),.;]+$/, '').replace(/&amp;|&#0*38;|&#x0*26;/gi, '&');
  if (!candidate) return null;
  try {
    const url = new URL(candidate), host = url.hostname.replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const result = (source: string, embed: string): VideoReview => ({url: url.href, source, embed});
    if (host === 'max.ru' && /^\/c\/[-\w]+\/[\w-]+\/?$/.test(url.pathname)) return {url: url.href, source: 'MAX'};
    if (['vk.com', 'vk.ru', 'vkvideo.ru', 'm.vk.com', 'm.vk.ru', 'm.vkvideo.ru'].includes(host)) {
      const match = url.pathname.match(/^\/(?:video|clip)(-?\d+)_(\d+)\/?$/)
        || url.searchParams.get('z')?.match(/^video(-?\d+)_(\d+)(?:[/?]|$)/);
      const external = url.pathname === '/video_ext.php';
      const owner = external ? url.searchParams.get('oid') : match?.[1];
      const id = external ? url.searchParams.get('id') : match?.[2];
      if (owner && id && /^-?[1-9]\d{0,19}$/.test(owner) && /^[1-9]\d{0,19}$/.test(id)) {
        const params = new URLSearchParams({oid: owner, id});
        const hash = url.searchParams.get('hash');
        if (hash && /^[\w-]{1,128}$/.test(hash)) params.set('hash', hash);
        const embed = `https://vkvideo.ru/video_ext.php?${params}`;
        // Keep an embed URL with its access hash through save/reload.
        return {url: external ? embed : url.href, source: 'VK Видео', embed};
      }
      return null;
    }
    if (['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1]
        : url.pathname === '/watch' ? url.searchParams.get('v')
        : url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
      if (id && /^[\w-]{11}$/.test(id)) return result('YouTube', `https://www.youtube-nocookie.com/embed/${id}`);
    }
    const rutube = host === 'rutube.ru' && url.pathname.match(/^\/(?:video|shorts|play\/embed)\/([a-f0-9]{32})\/?$/i);
    if (rutube) {
      const token = url.searchParams.get('p');
      return result('RUTUBE', `https://rutube.ru/play/embed/${rutube[1]}/${token ? '?p=' + encodeURIComponent(token) : ''}`);
    }
    const ok = ['ok.ru', 'm.ok.ru'].includes(host) && url.pathname.match(/^\/(?:video|videoembed)\/([1-9]\d{0,19})\/?$/);
    if (ok) return result('Одноклассники', `https://ok.ru/videoembed/${ok[1]}`);
    const vimeo = host === 'vimeo.com' ? url.pathname.match(/^\/([1-9]\d{0,19})(?:\/([a-f0-9]{6,64}))?\/?$/i)
      : host === 'player.vimeo.com' ? url.pathname.match(/^\/video\/([1-9]\d{0,19})\/?$/) : null;
    if (vimeo) {
      const hash = vimeo[2] || url.searchParams.get('h');
      return result('Vimeo', `https://player.vimeo.com/video/${vimeo[1]}${hash && /^[a-f0-9]{6,64}$/i.test(hash) ? '?h=' + hash : ''}`);
    }
    const kinescope = host === 'kinescope.io' && url.pathname.match(/^\/(?:embed\/)?([a-zA-Z0-9-]{6,64})\/?$/);
    if (kinescope) return result('Kinescope', `https://kinescope.io/embed/${kinescope[1]}`);
    // Dzen watch IDs and embed IDs differ: only the official embed address is used.
    const dzen = host === 'dzen.ru' && url.pathname.match(/^\/embed\/([\w-]{6,64})\/?$/);
    if (dzen) return result('Дзен', `https://dzen.ru/embed/${dzen[1]}?autoplay=0`);
    if (host === 'dzen.ru' && /^\/video\/watch\/[a-f0-9]{24}\/?$/i.test(url.pathname)) return {url: url.href, source: 'Дзен'};
    const dailymotion = host === 'geo.dailymotion.com' && url.pathname.match(/^\/player\/([a-zA-Z0-9]{3,64})\.html$/);
    const dmVideo = url.searchParams.get('video');
    if (dailymotion && dmVideo && /^[a-zA-Z0-9]{3,32}$/.test(dmVideo)) {
      return result('Dailymotion', `https://geo.dailymotion.com/player/${dailymotion[1]}.html?video=${dmVideo}`);
    }
    if (/\.(mp4|webm)$/i.test(url.pathname)) return {url: url.href, source: host, direct: true};
    return null;
  } catch { return null; }
}
export function videoReviews(...texts: unknown[]): VideoReview[] {
  const reviews = texts.flatMap(value => typeof value === 'string' ? links(value).map(videoReview).filter((x): x is VideoReview => !!x) : []);
  return reviews.filter((r, i) => reviews.findIndex(x => (x.embed || x.url) === (r.embed || r.url)) === i).slice(0, 6);
}
export function withoutVideoLinks(value: string) {
  return value.replace(/https?:\/\/[^\s<>"']+/gi, url => videoReview(url) ? '' : url)
    .replace(/^\s*Видео\s*обзор\s*(?:ссылка\s*на\s*)?(?:MAX|YouTube|RUTUBE|VK Видео|VK|ВК|Одноклассники|Vimeo|Kinescope|Дзен|Dailymotion)?\s*:\s*$/gim, '').trim();
}
