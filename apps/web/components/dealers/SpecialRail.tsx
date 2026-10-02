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
    <>{(["order","stock"] as const).map(kind=>{const visible=items.filter(o=>(o.availability||"order")===kind);return visible.length ? <section key={kind} className="my-8 min-w-0">
      <h2 className="text-2xl font-black leading-tight md:text-4xl">
        {kind==="stock" ? visible[0].heading || "Автомобили в наличии" : heading}
      </h2>
      <div className="mt-4 flex gap-4 overflow-x-auto pb-3">
        {visible.map((o) => (
          <Link
            key={o.id}
            href={o.href}
            className="w-64 shrink-0 overflow-hidden rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] md:w-80"
          >
            <img
              src={o.image}
              alt={o.title}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover"
            />
            <div className="space-y-2 p-4">
              <p className="text-xs font-bold text-emerald-600">{kind==="stock" ? `В наличии · ${o.condition==="used"?"С пробегом":"Новый"}` : "Под заказ"}</p>
              <h3 className="text-lg font-black">{o.title}</h3>
              <p className="text-xl font-black">
                {o.price === null
                  ? "Цена уточняется"
                  : `${o.price.toLocaleString("ru-RU")} ₽`}
              </p>
              <p className="text-sm text-[var(--ac-muted)]">
                {kind==="stock" ? [o.city,o.address].filter(Boolean).join(", ") : o.city ? `Цена с доставкой до ${o.city}` : "Базовая стоимость автомобиля"}
                {o.daysFrom ? ` · ${o.daysFrom}–${o.daysTo} дней` : ""}
              </p><p className="text-xs text-[var(--ac-muted)]">{kind==="stock" ? "Осмотр по адресу дилера" : "Доставка дальше — отдельно"}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>:null;})}</>
  );
}
