import { getVehicleOffers } from "@/lib/catalog";
export default function sitemap(){ const base="https://avtocena.com"; return getVehicleOffers().flatMap(o=>[{url:`${base}/cars/${o.market}`},{url:`${base}/cars/${o.market}/${encodeURIComponent(o.brand)}`},{url:`${base}/cars/${o.market}/${encodeURIComponent(o.brand)}/${encodeURIComponent(o.model)}`}]); }
