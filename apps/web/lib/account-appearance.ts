export const ACCOUNT_ROLES = [
  {id: 'customer', label: 'Пользователь'},
  {id: 'dealer', label: 'Автодилер'},
  {id: 'blogger', label: 'Автоблогер'},
  {id: 'supplier', label: 'Автопоставщик'},
] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number]['id'];
export type AccountMedia = {url:string; type:'image'|'video'; caption:string};
export type AccountArtwork = {banner:string;icon:string;backgroundLight?:string;backgroundDark?:string;colorLight?:string;colorDark?:string;media?:AccountMedia[];mediaDefaultsApplied?:boolean};
export type AccountAppearance = Partial<Record<AccountRole, AccountArtwork>>;

export function normalizeAccountAppearance(value: unknown): AccountAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: AccountAppearance = {};
  for (const {id} of ACCOUNT_ROLES) {
    const media = raw[id];
    if (!media || typeof media !== 'object' || Array.isArray(media)) continue;
    const row = media as Record<string, unknown>;
    const clean = (value: unknown) => {
      if (value === '' || value === undefined) return '';
      if (typeof value !== 'string' || !/^\/api\/site-media\/[a-f0-9]{64}$/.test(value)) throw Error('Загрузите изображение с устройства');
      return value;
    };
    const art:AccountArtwork={banner:clean(row.banner),icon:clean(row.icon)};
    if(row.mediaDefaultsApplied===true)art.mediaDefaultsApplied=true;
    for(const key of ['backgroundLight','backgroundDark'] as const)if(row[key]!==undefined)art[key]=clean(row[key]);
    for(const key of ['colorLight','colorDark'] as const)if(row[key]!==undefined){
      if(typeof row[key]!=='string'||!/^#[a-f0-9]{6}$/i.test(row[key] as string))throw Error('Выберите цвет фона');
      art[key]=row[key] as string;
    }
    if(row.media!==undefined){
      if(!Array.isArray(row.media)||row.media.length>6)throw Error('Можно добавить до 6 фото и видео');
      art.media=row.media.map(item=>{
        if(!item||typeof item!=='object'||!['image','video'].includes(item.type))throw Error('Выберите фото или видео');
        const valid=item.type==='video'?/^\/api\/site-media\/[a-f0-9]{64}\.mp4$/:/^\/api\/site-media\/[a-f0-9]{64}$/;
        if(typeof item.url!=='string'||!valid.test(item.url)&&!(item.type==='video'&&item.url===ACCOUNT_LOADING_VIDEO))throw Error('Загрузите файл с устройства');
        return {url:item.url,type:item.type,caption:typeof item.caption==='string'?item.caption.trim().slice(0,120):''};
      });
    }
    result[id] = art;
  }
  return result;
}

export const ACCOUNT_LOADING_VIDEO='/account-media/loading-oct05.mp4';
export function withAccountMediaDefaults(value:AccountAppearance={}):AccountAppearance {
 if(value.customer?.mediaDefaultsApplied===true)return value;
 const media=value.customer?.media||[];
 return {...value,customer:{banner:'',icon:'',...value.customer,mediaDefaultsApplied:true,media:media.some(m=>m.url===ACCOUNT_LOADING_VIDEO)||media.length>=6?media:[...media,{url:ACCOUNT_LOADING_VIDEO,type:'video',caption:'Погрузка автомобиля'}]}};
}
