// The registry already uses these fixed production JSON bridges in Actions.
// Admit only their bounded read routes; never a generic proxy or admin API.
export function isExistingPilotBridgeRequest(url, method, sourceId, pageLimit = 1) {
  if (method !== 'GET' || url.origin !== 'https://avtocena.com' || url.username || url.password || url.hash) return false;
  const query = [...url.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const match = (pathname, expected) => url.pathname === pathname && JSON.stringify(query) === JSON.stringify(expected);
  const maximum = Number.isInteger(pageLimit) ? Math.max(1, Math.min(5, pageLimit)) : 1;
  const page = url.searchParams.get(sourceId === 'myauto_georgia_list' ? 'startPage' : 'page');
  if (!/^[1-5]$/.test(page || '') || Number(page) > maximum) return false;
  if (sourceId === 'encar_direct') return match('/api/internal/encar-egress-71b8e4', [['page', page]]);
  if (sourceId === 'guazi_china_open') return match('/api/internal/guazi-egress-b8c4d1', [['page', page]]);
  if (sourceId === 'myauto_georgia_list') return match('/api/internal/georgia-recovery-e2f913', [['pages', '1'], ['source', 'myauto'], ['startPage', page]]);
  return false;
}
