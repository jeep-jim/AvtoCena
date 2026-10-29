import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {canEditEncyclopedia} from '@/lib/encyclopedia/records';
import {blogIndex,readBlogPost} from '@/lib/blog/records';
import {BlogEditor} from '@/components/blog/BlogEditor';
import '../../../(public)/blog/blog.css';
export const dynamic='force-dynamic';
export default async function BlogAdmin({searchParams}:{searchParams:Promise<{slug?:string;new?:string}>}){
 if(!canEditEncyclopedia(await getCurrentUser()))notFound();const params=await searchParams,post=params.slug?await readBlogPost(params.slug,true):null;
 if(params.slug&&!post)notFound();
 return <main className="ac-blog-editor"><nav><Link href="/crm/blog">Все статьи</Link><Link href="/crm/blog?new=1">Новая статья</Link><Link href="/blog">Автоблог</Link></nav><h1>{post?'Редактирование статьи':params.new?'Новая статья':'Статьи автоблога'}</h1>{post||params.new?<BlogEditor key={post?.slug||'new'} post={post}/>:<ul>{(await blogIndex(true)).map(p=><li key={p.slug}><Link href={`/crm/blog?slug=${p.slug}`}>{p.title}</Link> · {p.status==='published'?'Опубликована':'Черновик'}</li>)}</ul>}</main>;
}
