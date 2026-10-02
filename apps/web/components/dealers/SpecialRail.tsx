import Link from "next/link";
export type SpecialRailItem = {
  id: string;
  href: string;
  image: string;
  title: string;
  price: number | null;
  city: string;
  availability?: "order" | "stock";
  condition?: "new" | "used";
  address?: string;
  heading?: string;
  subtitle?: string;
  daysFrom?: number;
  daysTo?: number;
};
export function SpecialRail({
  heading,
  items,
}: {
  heading: string;
  items: SpecialRailItem[];
}) {
  if (!items.length) return null;
  return (
    <>{(["order","stock"] as const).map(kind=>{const visible=items.filter(o=>(o.availability||"order")===kind);return visible.length ? <section key={kind} className="my-5 min-w-0">
      <h2 className="text-lg font-black leading-tight md:text-2xl">
        {kind==="stock" ? visible[0].heading || "Автомобили в наличии" : heading}
      </h2>
      {visible[0].subtitle && visible.every(o=>o.subtitle===visible[0].subtitle&&o.heading===visible[0].heading)&&<p className="mt-1 break-words text-sm leading-relaxed text-[var(--ac-muted)]">{visible[0].subtitle}</p>}
      <div className="mt-4 flex gap-4 overflow-x-auto pb-3">
        {visible.map((o) => (
          <Link
            key={o.href}
            href={o.href}
            className="w-48 shrink-0 overflow-hidden rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] md:w-56"
          >
            <img
              src={o.image}
              alt={o.title}
              loading="lazy"
              className="aspect-[16/10] w-full object-cover"
            />
            <div className="space-y-1 p-3">
              <p className="text-xs font-bold text-emerald-600">{kind==="stock" ? `В наличии · ${o.condition==="used"?"С пробегом":"Новый"}` : "Под заказ"}</p>
              <h3 className="text-sm font-black">{o.title}</h3>
              <p className="text-base font-black">
                {o.price === null
                  ? "Цена уточняется"
                  : `${o.price.toLocaleString("ru-RU")} ₽`}
              </p>

            </div>
          </Link>
        ))}
      </div>
    </section>:null;})}</>
  );
}
