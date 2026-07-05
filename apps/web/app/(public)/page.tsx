import { HeroForm } from "../../components/forms/HeroForm";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-5 py-12">
        <div className="mb-10">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-brand-red">avtocena.com</div>
          <h1 className="max-w-3xl text-5xl font-black tracking-tight md:text-7xl">
            АвтоЦена
          </h1>
          <p className="mt-5 max-w-2xl text-xl text-neutral-600">
            Расчёт авто под ваш бюджет за 30 секунд.
          </p>
        </div>
        <HeroForm />
      </section>
    </main>
  );
}
