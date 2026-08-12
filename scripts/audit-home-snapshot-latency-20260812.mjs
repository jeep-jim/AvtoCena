const { readCatalogFacets, readHomeCatalogSnapshot } = await import('../apps/web/lib/catalog/storage.ts');
const iteration = Number(process.env.ITERATION || 0);
const start = performance.now();
const timed = async (name, fn) => {
  const t0 = performance.now();
  try {
    const value = await fn();
    const ms = performance.now() - t0;
    console.log(JSON.stringify({event:'overview_dep',iteration,name,ok:true,ms:Number(ms.toFixed(1)),count:Number(value?.total ?? value?.makes?.length ?? 0)}));
    return value;
  } catch (error) {
    const ms = performance.now() - t0;
    console.log(JSON.stringify({event:'overview_dep',iteration,name,ok:false,ms:Number(ms.toFixed(1)),error:String(error?.message || error)}));
    return null;
  }
};
await Promise.all([
  timed('facets', () => readCatalogFacets({})),
  timed('homeSnapshot', () => readHomeCatalogSnapshot(6)),
]);
console.log(JSON.stringify({event:'overview_dep_iteration',iteration,totalMs:Number((performance.now()-start).toFixed(1))}));
