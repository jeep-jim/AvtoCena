import {prepareCatalogColorIndex} from '../apps/web/lib/catalog/catalog-color-index.ts';
console.log('catalog-colors',JSON.stringify(await prepareCatalogColorIndex()));
