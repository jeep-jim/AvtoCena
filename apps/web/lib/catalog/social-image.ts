/** Separate JPEG rendition for link previews; gallery URLs remain unchanged. */
export function socialImageUrl(value:string){
 const url=new URL(value,'https://avtocena.com');
 if(url.origin==='https://avtocena.com'&&(/^\/api\/catalog\/photo\//.test(url.pathname)||/^\/api\/dealers\/[^/]+\/media\//.test(url.pathname)))url.searchParams.set('format','jpeg');
 return url.toString();
}
