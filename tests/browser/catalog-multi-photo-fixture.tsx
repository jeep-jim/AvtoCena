import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {Photos} from '../../apps/web/components/dealers/DealerEditorFields';
function App(){const [photos,setPhotos]=useState<any[]>([]);return <main style={{padding:16}}><CatalogFilters initial={{}} facets={{makes:['Toyota','Kia'],models:[]}}/><Photos dealerId="dealer_topavto" value={photos} onChange={setPhotos}/><output data-photos>{photos.length}</output></main>}
createRoot(document.getElementById('root')!).render(<App/>);
