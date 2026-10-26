import {Fragment} from 'react';
const safe=(s:string)=>/^https:\/\//.test(s)||/^\/(?!\/|api\/)[^\\]*$/.test(s);
/** Small Markdown subset. React escapes every text node; raw HTML is never rendered. */
function inline(text:string){
 return text.split(/(\*\*[^*\n]+\*\*|\[[^\]\n]{1,200}\]\([^\s)]+\))/g).map((part,i)=>{
  if(part.startsWith('**')&&part.endsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;
  const link=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  return link&&safe(link[2])?<a key={i} href={link[2]} {...(link[2].startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{link[1]}</a>:<Fragment key={i}>{part}</Fragment>;
 });
}
export function AutobotText({text}:{text:string}){
 const lines=text.split('\n'),blocks=[];
 for(let i=0;i<lines.length;){
  const line=lines[i];if(!line.trim()){i++;continue;}
  const title=line.match(/^#{1,6}\s+(.+)$/);if(title){blocks.push(<h3 key={i}>{inline(title[1])}</h3>);i++;continue;}
  if(/^\s*([-*•]|\d+[.)])\s+/.test(line)){
   const start=i,ordered=/^\s*\d+[.)]/.test(line),items=[];
   while(i<lines.length&&/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])){items.push(<li key={i}>{inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/,''))}</li>);i++;}
   blocks.push(ordered?<ol key={start}>{items}</ol>:<ul key={start}>{items}</ul>);continue;
  }
  if(/^\s*---+\s*$/.test(line)){blocks.push(<hr key={i}/>);i++;continue;}
  const start=i,paragraph=[];
  while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|\s*[-*•]\s|\s*\d+[.)]\s|---)/.test(lines[i])){paragraph.push(lines[i]);i++;}
  if(i===start){i++;continue;}
  blocks.push(<p key={start}>{inline(paragraph.join('\n'))}</p>);
 }
 return <div className="ab-rich-text">{blocks}</div>;
}
