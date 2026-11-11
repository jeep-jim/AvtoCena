import {BlogPostCard} from '@/components/blog/BlogPostCard';
import {CatalogPagination} from '@/components/catalog/CatalogPagination';
import {CatalogBreadcrumbs} from '@/components/catalog/CatalogBreadcrumbs';
import {EditorialHeader} from '@/components/layout/EditorialHeader';
import {getCurrentUser} from '@/lib/auth';
import {canEditEncyclopedia} from '@/lib/encyclopedia/records';
import {BlogAuthorActions} from '@/components/blog/BlogAuthorActions';
import {blogIndex} from '@/lib/blog/records';
import './blog.css';
export const dynamic='force-dynamic';
export const metadata={title:'Автоблог — новости и разборы автомобилей | АвтоЦена',description:'Автомобили, технологии и новинки: проверенные источники, понятные разборы и подбор автомобилей на АвтоЦене.',alternates:{canonical:'/blog'}};
export default async function Blog({searchParams}:{searchParams:Promise<{page?:string}>}){
 const [posts,user,params]=await Promise.all([blogIndex(),getCurrentUser(),searchParams]);const pages=Math.max(1,Math.ceil(posts.length/12)),page=Math.min(pages,Math.max(1,Math.floor(Number(params.page)||1)));
 return <><EditorialHeader backHref="/"/><main className="ac-blog"><CatalogBreadcrumbs items={[{label:"Главная",href:"/"},{label:"Автоблог",href:"/blog"}]}/><h1>Автоблог</h1><BlogAuthorActions canEdit={canEditEncyclopedia(user)}/><p className="ac-blog-intro">Новинки, технологии и подробности, которые помогают разобраться в автомобилях.</p><section className="ac-blog-grid">{posts.slice((page-1)*12,page*12).map(p=><BlogPostCard key={p.slug} post={p}/>)}</section>{!posts.length&&<p>Первые материалы готовятся к публикации.</p>}{pages>1&&<CatalogPagination page={page} pageCount={pages} label="Страницы блога" links={[...new Set([1,...Array.from({length:5},(_,i)=>Math.max(1,Math.min(page-2,pages-4))+i),pages])].filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b).map(n=>({page:n,href:`/blog?page=${n}`}))} previousHref={page>1?`/blog?page=${page-1}`:undefined} nextHref={page<pages?`/blog?page=${page+1}`:undefined}/>}</main></>;
}
