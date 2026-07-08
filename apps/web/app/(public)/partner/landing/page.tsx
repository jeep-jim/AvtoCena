import { PartnerShell } from "@/components/partner/PartnerShell";
import { money } from "@/lib/avtocena";

export default function PartnerLandingPage() {
  return (
    <PartnerShell title="Зарабатывайте на заявках АвтоЦена" subtitle="Вы приводите клиента на расчёт авто под бюджет. TopAvto доводит до договора и сделки. За подписанный договор партнёр получает выплату.">
      <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
        <div className="glass rounded-[2rem] p-6 md:p-8">
          <div className="text-6xl font-black tracking-[-0.06em]">{money(10000)} ₽</div>
          <div className="mt-2 text-xl font-black text-white/72">за подписанный договор</div>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {["Личная ссылка и QR", "Кабинет с переходами", "Статусы лидов", "Postback для CPA", "Сайт + PWA + Mini App", "Коммерческие авто-ключи"].map((item) => (
              <div key={item} className="rounded-2xl bg-white/7 p-4 font-bold text-white/68">{item}</div>
            ))}
          </div>
          <a href="/partner?ref=demo" className="avto-button mt-6 inline-block rounded-2xl px-6 py-4 font-black">Открыть демо кабинет</a>
        </div>

        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">Как это работает</h2>
          <div className="mt-5 space-y-4">
            {["Получаете ссылку вида avtocena.com/?ref=your_code", "Пользователь узнаёт АвтоЦену", "Оставляет заявку и заключает договор", "В кабинете появляется начисление"].map((step, index) => (
              <div key={step} className="flex gap-3 rounded-2xl bg-white/7 p-4">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-500 text-sm font-black">{index + 1}</div>
                <div className="font-bold text-white/68">{step}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PartnerShell>
  );
}
