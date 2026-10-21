import {labels,numberFields,textFields,statusLabels,modelHref,type ModelRecord} from './schema';
export function csvCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export const csvHeader=['ID модели','ID модификации','Марка','Модель','Фото',...numberFields.map(f=>labels[f]),...textFields.map(f=>labels[f]),'Рынки','Проверка','Объявлений в снимке','Страница модели'].map(csvCell).join(';')+'\r\n';
export function modelCsv(model:ModelRecord){return model.variants.map(v=>[model.id,v.id,model.make,model.model,model.photo,...numberFields.map(f=>v[f]),...textFields.map(f=>v[f]),v.markets.join(', '),statusLabels[v.status],v.observedCount,'https://avtocena.com'+modelHref(model.id)].map(csvCell).join(';')).join('\r\n')+'\r\n';}
