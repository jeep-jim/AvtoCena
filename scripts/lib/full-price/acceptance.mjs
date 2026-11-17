import assert from 'node:assert/strict';
export function assertFullpriceAcceptance(rows){
 assert.ok(rows.some(x=>x.result.fullPriceAccepted),'fullprice_no_accepted_rows');
 assert.ok(rows.every(x=>x.result.status!=='complete'||x.result.priceChecksPassed===true),'fullprice_complete_arithmetic_rejected');
 for(const coordinate of [{page:1,row:1},{page:1,row:4}]){
  const cells=rows.filter(x=>x.coordinate.page===coordinate.page&&x.coordinate.row===coordinate.row);
  assert.equal(cells.length,4,'fullprice_control_cells_missing');
  assert.equal(new Set(cells.map(x=>x.producer+'/'+x.app)).size,4,'fullprice_control_cells_missing');
  assert.ok(cells.every(x=>x.result.fullPriceAccepted),'fullprice_control_not_accepted');
  assert.ok(cells.every(x=>x.result.totalRub===cells[0].result.totalRub),'fullprice_unchanged_control_total_changed');
 }
}
