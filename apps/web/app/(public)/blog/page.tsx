import Link from 'next/link';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {blogIndex} from '@/lib/blog/records';
import './blog.css';
export const dynamic='force-dynamic';
export const metadata={title:'Автоблог — новости и разборы автомобилей | АвтоЦена',description:'Автомобили, технологии и новинки: проверенные источники, понятные разборы и подбор автомобилей на АвтоЦене.',alternates:{canonical:'/blog'}};
export default async function Blog({searchParams}:{searchParams:Promise<{page?:string}>}){
 const posts=await blogIndex(),params=await searchParams,pages=Math.max(1,Math.ceil(posts.length/12)),page=Math.min(pages,Math.max(1,Math.floor(Number(params.page)||1)));
 return <><PublicHeader backHref="/"/><main className="ac-blog"><p>АвтоЦена · журнал об автомобилях</p><h1>Автоблог</h1><p className="ac-blog-intro">Новинки, технологии и подробности, которые помогают разобраться в автомобилях.</p><section className="ac-blog-grid">{posts.slice((page-1)*12,page*12).map(p=><article className="ac-blog-card" key={p.slug}><Link href={`/blog/${p.slug}`} prefetch={false}>{p.cover&&<img src={p.cover} alt={p.title} loading="lazy" decoding="async"/>}<div><time dateTime={p.publishedAt}>{new Date(p.publishedAt).toLocaleDateString('ru-RU')}</time><h2>{p.title}</h2><p>{p.description}</p></div></Link></article>)}</section>{!posts.length&&<p>Первые материалы готовятся к публикации.</p>}{pages>1&&<nav aria-label="Страницы блога">{page>1&&<Link href={`/blog?page=${page-1}`}>Назад</Link>} <span>{page} / {pages}</span> {page<pages&&<Link href={`/blog?page=${page+1}`}>Далее</Link>}</nav>}</main></>;
}
