"use client";
import {ajesCountText} from "@/lib/catalog/ajes-count-display";
import { useEffect, useState } from "react";

/** The homepage has one count owner. Errors are not empty search results. */
export function useHomeCatalogCount(query: string, catalogTotal: number | null) {
  const baseCount = query ? null : catalogTotal;
  const [result, setResult] = useState<{query: string; count: number | null; error: boolean;countText?:string}>({query, count: baseCount, error: false});
  useEffect(() => {
    if (!query && baseCount !== null) {
      setResult({query, count: baseCount, error: false});
      return;
    }
    const controller = new AbortController();
    let active = true;
    let timeout = 0;
    setResult({query, count: null, error: false});
    const timer = window.setTimeout(async () => {
      timeout = window.setTimeout(() => {
        if (!active) return;
        controller.abort();
        setResult({query, count: null, error: true});
      }, 20_000);
      try {
        const response = await fetch(`/api/catalog/search?countOnly=1&${query}`, {signal: controller.signal});
        if (!response.ok) throw new Error("catalog_count_failed");
        const data = await response.json();
        const summary=data?.countSummary;
        if(data?.ok!==false&&Number.isSafeInteger(summary?.total)&&summary.total>=0){
          if(active&&!controller.signal.aborted)setResult({query,count:null,error:false,countText:ajesCountText(summary)});
          return;
        }
        if (data?.countIncomplete || data?.ok === false || typeof data?.total !== "number" || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error("catalog_count_invalid");
        if (active && !controller.signal.aborted) setResult({query, count: data.total, error: false});
      } catch {
        if (active && !controller.signal.aborted) setResult({query, count: null, error: true});
      } finally { window.clearTimeout(timeout); }
    }, 180);
    return () => { active = false; window.clearTimeout(timer); window.clearTimeout(timeout); controller.abort(); };
  }, [query, baseCount]);
  if (!query && baseCount !== null) return {count: baseCount, countError: false,countText:undefined};
  return result.query === query ? {count: result.count, countError: result.error,countText:result.countText} : {count: null, countError: false,countText:undefined};
}
