import { namedTechnicalGroups } from "./source-table-capture";
import type { SourceSpecificationSnapshot } from "./source-specifications";

const plain = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&")
  .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n))))
  .replace(/\s+/g," ").trim();

/** Only pass the primary vehicle's bounded detail block, never a whole listing page. */
export function htmlTechnicalGroups(markup: string): SourceSpecificationSnapshot["groups"] {
  const groups: SourceSpecificationSnapshot["groups"] = [];
  for (const table of markup.matchAll(/<(table|dl)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const rows: Array<{name:string;value:string}> = [];
    if (table[1].toLowerCase()==="dl") {
      for (const row of table[2].matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
        rows.push({name:plain(row[1]),value:plain(row[2])});
      }
    } else {
      for (const row of table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells=[...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(cell=>plain(cell[1]));
        // A multi-vehicle comparison is not this vehicle's specification.
        if(cells.length===2) rows.push({name:cells[0],value:cells[1]});
      }
    }
    const title=plain(table[2].match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "Характеристики источника");
    groups.push(...namedTechnicalGroups(rows.filter(row=>row.name),title));
  }
  return groups;
}
