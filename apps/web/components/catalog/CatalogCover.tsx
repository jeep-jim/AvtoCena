"use client";
import { useState } from "react";
import { catalogCoverThumbnail } from "@/lib/catalog/cover-image";
export function CatalogCover({src, alt, eager}: {src:string; alt:string; eager:boolean}) {
  const [failed, setFailed] = useState(false);
  return <img src={failed ? src : catalogCoverThumbnail(src)} alt={alt} width={400} height={300} className="h-full w-full object-cover object-[center_42%]" loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "auto" : "low"} onError={() => setFailed(true)} />;
}
