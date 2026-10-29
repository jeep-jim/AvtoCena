export type BlogPost={slug:string;title:string;description:string;body:string;cover:string;coverCredit:string;sources:{title:string;url:string}[];related:{title:string;url:string}[];status:'draft'|'published';publishedAt:string;updatedAt:string;revision:string};
export type BlogSummary=Omit<BlogPost,'body'|'sources'|'related'> & {key?:string};
export class BlogInputError extends Error{}
export function blogUrl(value:unknown,internal=false){const s=String(value||'').trim();if(internal){try{const u=new URL(s,'https://avtocena.com');return s.startsWith('/cars')&&u.origin==='https://avtocena.com'&&/^\/cars(?:\/|$)/.test(u.pathname)&&!/[\\\s]/.test(s)?s:'';}catch{return '';}}try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?s:'';}catch{return '';}}
export function cleanBlogPost(input:Record<string,unknown>):Omit<BlogPost,'revision'|'updatedAt'|'publishedAt'>{
 const text=(key:string,max:number)=>String(input[key]||'').trim().slice(0,max);
 const slug=text('slug',100),title=text('title',180),description=text('description',320),body=text('body',40000),cover=text('cover',2000),coverCredit=text('coverCredit',500);
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||title.length<5||description.length<10||body.length<100)throw new BlogInputError('Заполните адрес, заголовок, описание и текст статьи.');
 if(cover&&(!blogUrl(cover)||!coverCredit))throw new BlogInputError('Укажите HTTPS-адрес фотографии и её источник / права.');
 const links=(key:string,internal:boolean)=>{const raw=input[key];if(!Array.isArray(raw)||raw.length>20)throw new BlogInputError('Проверьте ссылки.');return raw.map(v=>{if(!v||typeof v!=='object')throw new BlogInputError('Проверьте ссылки.');const title=String(v.title||'').trim().slice(0,180),url=blogUrl(v.url,internal);if(!title||!url)throw new BlogInputError('Проверьте названия и адреса ссылок.');return {title,url};});};
 const sources=links('sources',false),related=links('related',true),status=input.status==='published'?'published':'draft';
 if(status==='published'&&!sources.length)throw new BlogInputError('Добавьте первоисточники перед публикацией.');
 return {slug,title,description,body,cover,coverCredit,sources,related,status};
}
