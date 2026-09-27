import {readCurrentPublicCatalogProjection} from '../apps/web/lib/catalog/storage.ts';
import {rememberPublishedVehicles} from '../apps/web/lib/catalog/knowledge-memory.ts';
const snapshot=await readCurrentPublicCatalogProjection();
console.log(JSON.stringify({generationId:snapshot.generationId,...await rememberPublishedVehicles(snapshot.rows)}));
