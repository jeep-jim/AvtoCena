import Link from 'next/link';
export function BlogAuthorActions({canEdit,slug}:{canEdit:boolean;slug?:string}){
 if(!canEdit)return null;
 return <nav className="ac-blog-author-actions" aria-label="Управление статьями"><Link href="/crm/blog?new=1">Написать статью</Link><Link href="/crm/blog">Мои статьи</Link>{slug&&<Link href={`/crm/blog?slug=${encodeURIComponent(slug)}`}>Редактировать статью</Link>}</nav>;
}
