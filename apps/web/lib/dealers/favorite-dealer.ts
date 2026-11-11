// The ID is authoritative; older favorites did not store dealer metadata.
export function favoriteDealer(item: {id: string; dealerName?: string; marketLabel?: string}) {
  const match = /^special_([a-zA-Z0-9_-]{1,80})__([a-zA-Z0-9-]{1,80})$/.exec(item.id);
  const id = match?.[1] || 'dealer_topavto';
  const name = match
    ? item.dealerName || item.marketLabel?.split(' · ').slice(1).join(' · ') || (id === 'dealer_topavto' ? 'ТопАвто' : 'Дилер')
    : 'ТопАвто';
  return {id, name};
}
