import Link from "next/link";
export type SpecialRailItem = {
  id: string;
  href: string;
  image: string;
  title: string;
  price: number | null;
  city: string;
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
    <section className="my-8 min-w-0">
      <h2 className="text-2xl font-black leading-tight md:text-4xl">
        {heading}
      </h2>
      <div className="mt-4 flex gap-4 overflow-x-auto pb-3">
        {items.map((o) => (
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
              <h3 className="text-lg font-black">{o.title}</h3>
              <p className="text-xl font-black">
                {o.price === null
                  ? "Цена уточняется"
                  : `${o.price.toLocaleString("ru-RU")} ₽`}
              </p>
              <p className="text-sm text-[var(--ac-muted)]">
                {o.city ? `Цена с доставкой до ${o.city}` : "Базовая стоимость автомобиля"}
                {o.daysFrom ? ` · ${o.daysFrom}–${o.daysTo} дней` : ""}
              </p><p className="text-xs text-[var(--ac-muted)]">Доставка дальше — отдельно</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
