// Operation.Get uses the shared operation service, not the resource API host.
export async function waitForYandexOperation(initial, request, pause = ms => new Promise(resolve=>setTimeout(resolve,ms))) {
 let operation=initial;
 for(let attempt=0; !operation.done && attempt<30; attempt++) {
  if(!operation.id)throw new Error('Missing Yandex operation ID');
  await pause(1000);
  operation=await request('https://operation.api.cloud.yandex.net/operations/'+encodeURIComponent(operation.id));
 }
 if(!operation.done || operation.error)throw new Error(`Yandex operation failed: ${initial.id || 'unknown'} code=${operation.error?.code || 'timeout'}`);
 return operation;
}
