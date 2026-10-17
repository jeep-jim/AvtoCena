import {backfillCatalogGenerationDirectories} from '../apps/web/lib/catalog/storage.ts';
console.log(JSON.stringify(await backfillCatalogGenerationDirectories()));
