/** Same source object at its documented/observed 400px rendition. */
export function catalogCoverThumbnail(source: string) {
  try {
    const url = new URL(source);
    if (url.hostname === "img.akebono.world" && /^\/[a-f0-9-]+\.(jpe?g|png|webp)$/i.test(url.pathname)) {
      url.pathname = `/400x300${url.pathname}`;
      return url.href;
    }
    if (/^jp\d*\.pa-server\.ru$/.test(url.hostname) && /^\/auc_auto\/\d{4}_\d{2}_\d{2}\/\d+\/[^/]+\.webp$/.test(url.pathname)) {
      const index = url.pathname.lastIndexOf('/');
      url.pathname = `${url.pathname.slice(0,index)}/400${url.pathname.slice(index)}`;
      return url.href;
    }
  } catch { /* Keep the original URL unchanged. */ }
  return source;
}
