import {randomUUID} from 'node:crypto';
import seed from '../../content/blog/posts.json';
import {getJsonStorage,mutateDataJson} from '../data';
import {cleanBlogPost,BlogInputError,type BlogPost,type BlogSummary} from './schema';
const INDEX='content/blog/v1/index.json';
const seeds=seed as BlogPost[];
export class BlogConflict extends Error{}
export async function blogIndex(includeDrafts=false){
 const saved=await getJsonStorage().readJson<BlogSummary[]>(INDEX,[]),rows=new Map<string,BlogSummary>(seeds.map(({body,sources,related,...post})=>[post.slug,post]));
 for(const post of saved)rows.set(post.slug,post);
 return [...rows.values()].filter(p=>includeDrafts||p.status==='published').sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.slug.localeCompare(b.slug));
}
export async function readBlogPost(slug:string,includeDrafts=false){
 const summary=(await blogIndex(true)).find(p=>p.slug===slug);if(!summary||!includeDrafts&&summary.status!=='published')return null;
 return summary.key?getJsonStorage().readJson<BlogPost|null>(summary.key,null):seeds.find(p=>p.slug===slug)||null;
}
/** Share one authoritative index read between the article and related cards.
 * No time-based cache: an unpublished article must disappear immediately.
 */
export async function readBlogArticle(slug:string){
 const posts=await blogIndex();
 const summary=posts.find(post=>post.slug===slug);
 if(!summary)return null;
 const post=summary.key?await getJsonStorage().readJson<BlogPost|null>(summary.key,null):seeds.find(post=>post.slug===slug)||null;
 if(!post||post.status!=='published')return null;
 return {post,related:posts.filter(row=>row.slug!==slug).slice(0,3)};
}
export async function saveBlogPost(input:Record<string,unknown>){
 const clean=cleanBlogPost(input),old=await readBlogPost(clean.slug,true);
 if(old&&old.revision!==input.revision||!old&&input.revision)throw new BlogConflict('Статья уже изменена. Обновите страницу.');
 const now=new Date().toISOString(),post:BlogPost={...clean,revision:randomUUID(),updatedAt:now,publishedAt:old?.publishedAt||(clean.status==='published'?now:'')};
 const key=`content/blog/v1/posts/${post.slug}/${post.revision}.json`;
 await getJsonStorage().writeJson(key,post,{ifNoneMatch:'*'});
 const {body,sources,related,...summary}=post;
 await mutateDataJson<BlogSummary[]>(INDEX,[],rows=>{const current=rows.find(p=>p.slug===post.slug)||seeds.find(p=>p.slug===post.slug);if((current?.revision||'')!==(old?.revision||''))throw new BlogConflict('Статья уже изменена. Обновите страницу.');return [...rows.filter(p=>p.slug!==post.slug),{...summary,key}];});return post;
}
