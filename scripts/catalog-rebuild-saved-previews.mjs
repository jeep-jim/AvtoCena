import {rebuildSavedPreviewIndex} from '../apps/web/lib/catalog/saved-calculation-previews.ts';
const index=await rebuildSavedPreviewIndex();
const entries=Object.entries(index.entries);
console.log(JSON.stringify({savedPreviews:entries.length,markets:[...new Set(entries.map(([,entry])=>entry.market))],sampleIds:entries.slice(0,8).map(([id])=>id)}));
