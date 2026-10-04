"use client";
export function ClientCityMode({value,onChange}:{value:boolean;onChange:(value:boolean)=>void}) {
 return <label className="mt-4 flex items-center gap-2 text-sm text-[var(--ac-muted)]"><input type="checkbox" checked={value} onChange={event=>onChange(event.target.checked)} className="h-4 w-4 accent-[#ff353d]"/>Отдельный город для клиента</label>;
}
