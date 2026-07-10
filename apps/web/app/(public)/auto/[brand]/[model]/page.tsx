import type { Metadata } from "next";
import { getAvtocenaCases, money } from "@/lib/avtocena";
import { BrandMark } from "@/components/brand/BrandMark";

export async function generateMetadata({ params }: { params: Promise<{ brand: string; model: string }> }): Promise<Metadata> {
  const { brand, model } = await params;
  const title = `${brand.toUpperCase()} ${model.replaceAll("-", " ")} под заказ — АвтоЦена под ключ`;
  return {
    title,
    description: `Цена ${brand} ${model} под заказ: доставка, таможня, утильсбор, оформление и итоговая АвтоЦена под ключ в России.`
  };
}

export async function generateStaticParams() {
  return getAvtocenaCases().map((item) => ({
    brand: item.brand.toLowerCase(),
    model: item.model.toLowerCase().replace(/\s+/g, "-")
  }));
}

export default async function ModelSeoPage({ params }: { params: Promise<{ brand: string; model: string }> }) {
  const { brand, model } = await params;
  const humanBrand = brand.toLowerCase();
  const humanModel = model.replaceAll("-", " ").toLowerCase();
  const items = getAvtocenaCases().filter((item) => item.brand.toLowerCase() === humanBrand && item.model.toLowerCase() === humanModel);
  const item = items[0];

  return (
    <main className="min-h-screen px-5 py-8 md:px-8">
      <div className="mx-auto w-full max-w-[1500px]">
        <a href="/" className="inline-flex items-center gap-2.5 text-sm font-black text-white/70 transition hover:text-white">
          <BrandMark className="h-9 w-9 shrink-0" />
          <span>
            <span className="text-red-500">Авто</span><span className="text-white">Цена</span>
            <span className="ml-2 text-white/45">← назад к подбору</span>
          </span>
        </a>
        <section className="glass mt-6 rounded-[2rem] p-6 md:p-9">
          <div className="text-sm font-black uppercase tracking-[0.18em] text-red-300">SEO страница</div>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.04em] md:text-6xl">
            {item ? item.title : `${brand.toUpperCase()} ${model.replaceAll("-", " ")}`} под заказ
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-white/62">
            Узнайте АвтоЦену под ключ в России: покупка автомобиля, доставка, таможенное оформление, утильсбор, ЭПТС, СБКТС и комиссия компании.
          </p>
          {item && (
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl bg-white/7 p-5"><div className="text-sm font-bold text-white/45">Страна</div><div className="mt-2 text-2xl font-black">{item.marketName}</div></div>
              <div className="rounded-3xl bg-white/7 p-5"><div className="text-sm font-bold text-white/45">Год</div><div className="mt-2 text-2xl font-black">{item.year}</div></div>
              <div className="rounded-3xl bg-white/7 p-5"><div className="text-sm font-bold text-white/45">АвтоЦена</div><div className="mt-2 text-2xl font-black">{money(item.totalRub)} ₽</div></div>
            </div>
          )}
          <a href={`/results?brand=${brand}&model=${model}`} className="avto-button mt-8 inline-block rounded-2xl px-6 py-4 font-black">Узнать АвтоЦену</a>
        </section>
      </div>
    </main>
  );
}
