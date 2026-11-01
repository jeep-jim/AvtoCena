import Link from 'next/link';
import type {BlogSummary} from '@/lib/blog/schema';
export function BlogPostCard({post:p}:{post:BlogSummary}){
 return <article className="ac-blog-card"><Link href={`/blog/${p.slug}`} prefetch={false}>{p.cover&&<img src={p.cover} alt={p.title} loading="lazy" decoding="async"/>}<div className="ac-blog-card-copy"><time dateTime={p.publishedAt}>{new Date(p.publishedAt).toLocaleDateString('ru-RU')}</time><h2>{p.title}</h2><p>{p.description}</p></div></Link></article>;
}
