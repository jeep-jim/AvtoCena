import {Fragment,type ReactNode} from 'react';
// Deliberately limited formatting. Content is always React text, never HTML.
export function IdeaText({text,depth=0}:{text:string;depth?:number}){
 if(depth>8)return <>{text}</>;
 const pattern=/(\*\*([\s\S]+?)\*\*|\*([^*\n]+?)\*|\[u\]([\s\S]+?)\[\/u\]|\[mark\]([\s\S]+?)\[\/mark\]|\[color=(red|blue|green)\]([\s\S]+?)\[\/color\]|https?:\/\/[^\s<>\[\]]+)/g;
 const parts:ReactNode[]=[];let last=0;let m:RegExpExecArray|null;
 while((m=pattern.exec(text))){parts.push(text.slice(last,m.index));const inner=(v:string)=><IdeaText text={v} depth={depth+1}/>;let node:ReactNode;
  if(m[2])node=<strong>{inner(m[2])}</strong>;
  else if(m[3])node=<em>{inner(m[3])}</em>;
  else if(m[4])node=<u>{inner(m[4])}</u>;
  else if(m[5])node=<mark>{inner(m[5])}</mark>;
  else if(m[6])node=<span className={`idea-color-${m[6]}`}>{inner(m[7])}</span>;
  else {let url:URL|undefined;try{url=new URL(m[0]);}catch{}node=url&&['https:','http:'].includes(url.protocol)?<a href={url.href} target="_blank" rel="noopener noreferrer" className="underline">{m[0]}</a>:m[0];}
  parts.push(<Fragment key={m.index}>{node}</Fragment>);last=pattern.lastIndex;
 }
 parts.push(text.slice(last));return <>{parts}</>;
}
