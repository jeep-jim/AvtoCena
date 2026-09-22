import {NextResponse} from "next/server";
import {readSavedPreviewIndex} from "../../../../lib/catalog/saved-calculation-previews";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 const ids=new URL(request.url).searchParams.get("ids")||"";
 const keys=[...new Set(ids.split(",").filter(Boolean))];
 if(ids.length>6000||keys.length>50||keys.some(id=>!/^[a-zA-Z0-9_-]{1,120}$/.test(id)))return NextResponse.json({error:"invalid_ids"},{status:400});
 const index=keys.length?await readSavedPreviewIndex():null;
 const previews=Object.fromEntries(keys.map(id=>{const e=index?.entries[id];return [id,e?{market:e.market,sourceGroup:e.sourceId,preview:e.preview}:null]}));
 return NextResponse.json({previews},{headers:{"Cache-Control":"no-store"}});
}
