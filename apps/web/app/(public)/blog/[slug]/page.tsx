import Link from 'next/link';
import {notFound} from 'next/navigation';
import {cache} from 'react';
import {getCurrentUser} from '@/lib/auth';
import {canEditEncyclopedia} from '@/lib/encyclopedia/records';
import {BlogAuthorActions} from '@/components/blog/BlogAuthorActions';
import {readBlogPost} from '@/lib/blog/records';
import {EditorialHeader} from '@/components/layout/EditorialHeader';
import {BlogBody} from '@/components/blog/BlogBody';
import '../blog.css';
export const dynamic='force-dynamic';
const read=cache(readBlogPost);
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){const {slug}=await params,p=await read(slug);if(!p)return {};return {title:`${p.title} | АвтоЦена`,description:p.description,alternates:{canonical:`/blog/${p.slug}`},openGraph:{type:'article',title:p.title,description:p.description,images:p.cover?[p.cover]:[],publishedTime:p.publishedAt,modifiedTime:p.updatedAt}};}
export default async function Article({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const [p,user]=await Promise.all([read(slug),getCurrentUser()]);if(!p)notFound();
 const structured={'@context':'https://schema.org','@type':'BlogPosting',headline:p.title,description:p.description,image:p.cover||undefined,datePublished:p.publishedAt,dateModified:p.updatedAt,mainEntityOfPage:`https://avtocena.com/blog/${p.slug}`,author:{'@type':'Organization',name:'Редакция АвтоЦены'}};
 return <><EditorialHeader backHref="/blog" backLabel="В автоблог"/><article className="ac-blog ac-blog-article"><Link href="/blog">Автоблог</Link><h1>{p.title}</h1><BlogAuthorActions canEdit={canEditEncyclopedia(user)} slug={p.slug}/><p className="ac-blog-intro">{p.description}</p><p><time dateTime={p.publishedAt}>{new Date(p.publishedAt).toLocaleDateString('ru-RU')}</time> · Редакция АвтоЦены</p>{p.cover&&<figure className="ac-blog-cover"><img src={p.cover} alt={p.title} fetchPriority="high"/><figcaption>{p.coverCredit}</figcaption></figure>}<BlogBody body={p.body}/>{p.related.length>0&&<aside className="ac-blog-related"><h2>Автомобили на АвтоЦене</h2>{p.related.map(l=><Link key={l.url} href={l.url} prefetch={false}>{l.title}</Link>)}</aside>}<section className="ac-blog-sources"><h2>Источники</h2><ul>{p.sources.map(l=><li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a></li>)}</ul></section><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structured).replace(/</g,'\\u003c')}}/></article></>;
}
