import { getRecommendations } from "@avtocena/engine";

export default function ResultsPage() {
  const results = getRecommendations({ budgetRub: 3000000 });

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-4xl font-black">Ваша АвтоЦена</h1>
      <p className="mt-2 text-neutral-600">Первые варианты под ваш бюджет.</p>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {results.map((car) => (
          <article key={car.id} className="rounded-3xl border border-neutral-200 p-5 shadow-sm">
            <div className="text-sm font-bold text-brand-red">{car.market}</div>
            <h2 className="mt-2 text-2xl font-black">{car.title}</h2>
            <p className="mt-2 text-neutral-600">{car.year} · {car.fuel} · {car.powerHp} л.с.</p>
            <div className="mt-5 text-3xl font-black">{car.estimatedPriceRub.toLocaleString("ru-RU")} ₽</div>
            <button className="mt-5 w-full rounded-2xl bg-black px-5 py-4 font-bold text-white">Получить предложение</button>
          </article>
        ))}
      </div>
    </main>
  );
}
