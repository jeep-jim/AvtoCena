import Link from 'next/link';
import {CatalogBreadcrumbs} from '@/components/catalog/CatalogBreadcrumbs';
import {notFound} from 'next/navigation';
import {cache} from 'react';
import {getCurrentUser} from '@/lib/auth';
import {canEditEncyclopedia} from '@/lib/encyclopedia/records';
import {BlogAuthorActions} from '@/components/blog/BlogAuthorActions';
import {BlogPostCard} from '@/components/blog/BlogPostCard';
import {BlogShareButton} from '@/components/blog/BlogShareButton';
import {readBlogPost,blogIndex} from '@/lib/blog/records';
import {EditorialHeader} from '@/components/layout/EditorialHeader';
import {BlogBody} from '@/components/blog/BlogBody';
import '../blog.css';
export const dynamic='force-dynamic';
const read=cache(readBlogPost);
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){const {slug}=await params,p=await read(slug);if(!p)return {};return {title:`${p.title} | АвтоЦена`,description:p.description,alternates:{canonical:`/blog/${p.slug}`},openGraph:{type:'article',title:p.title,description:p.description,images:p.cover?[p.cover]:[],publishedTime:p.publishedAt,modifiedTime:p.updatedAt}};}
export default async function Article({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const [p,user,posts]=await Promise.all([read(slug),getCurrentUser(),blogIndex()]);if(!p)notFound();
 const others=posts.filter(post=>post.slug!==slug).slice(0,3);
 const structured={'@context':'https://schema.org','@type':'BlogPosting',headline:p.title,description:p.description,image:p.cover||undefined,datePublished:p.publishedAt,dateModified:p.updatedAt,mainEntityOfPage:`https://avtocena.com/blog/${p.slug}`,author:{'@type':'Organization',name:'Редакция АвтоЦены'}};
 return <><EditorialHeader backHref="/blog" backLabel="В автоблог"/><article className="ac-blog ac-blog-article"><CatalogBreadcrumbs items={[{label:"Главная",href:"/"},{label:"Автоблог",href:"/blog"}]}/><h1>{p.title}</h1><BlogAuthorActions canEdit={canEditEncyclopedia(user)} slug={p.slug}/><p className="ac-blog-intro">{p.description}</p><p><time dateTime={p.publishedAt}>{new Date(p.publishedAt).toLocaleDateString('ru-RU')}</time> · Редакция АвтоЦены</p>{p.cover&&<figure className="ac-blog-cover"><img src={p.cover} alt={p.title} fetchPriority="high"/><figcaption>{p.coverCredit}</figcaption></figure>}<BlogBody body={p.body}/>{p.related.length>0&&<aside className="ac-blog-related"><h2>Автомобили на АвтоЦене</h2>{p.related.map(l=><Link key={l.url} href={l.url} prefetch={false}>{l.title}</Link>)}</aside>}<section className="ac-blog-sources"><h2>Источники</h2><ul>{p.sources.map(l=><li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a></li>)}</ul></section><BlogShareButton title={p.title} slug={p.slug}/>{others.length>0&&<section className="ac-blog-more" aria-labelledby="other-posts"><h2 id="other-posts">Другие публикации</h2><div className="ac-blog-grid">{others.map(post=><BlogPostCard key={post.slug} post={post}/>)}</div></section>}<script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structured).replace(/</g,'\\u003c')}}/></article></>;
}
