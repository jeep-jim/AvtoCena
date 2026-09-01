import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { DealerHeroPreview } from "@/components/dealers/DealerHeroPreview";

export const metadata: Metadata = {
  title: "АвтоЦена для дилеров — CRM и заявки на автомобили под заказ",
  description: "Готовая CRM для компаний по привозу автомобилей: клиенты, менеджеры, расчёты, Telegram и новые заявки в одном сервисе.",
};

const crmBenefits = [
  ["01", "Единая база клиентов", "Контакты, запросы, бюджеты, история общения, отправленные автомобили и все сделки компании."],
  ["02", "Работа менеджеров", "Назначение заявок, сроки ответа, комментарии, задачи и контроль результата каждого сотрудника."],
  ["03", "Расчёт под ключ", "Курс, расходы рынка, логистика, таможня, утильсбор, лаборатория, ЭПТС и доставка в город клиента."],
  ["04", "Telegram в CRM", "Бот понимает запрос клиента, создаёт заявку, считает подходящие варианты и передаёт диалог менеджеру."],
  ["05", "Собственные и наши заявки", "Ведите клиентов из своей рекламы бесплатно и дополнительно получайте обращения от АвтоЦена."],
  ["06", "Профиль дилера", "Карточка компании, города, рынки, выдачи, отзывы и живая лента новостей из Telegram."],
] as const;

const workflow = [
  ["Клиент оставляет запрос", "Сайт или Telegram определяет город, бюджет, тип автомобиля и предпочтения клиента."],
  ["АвтоЦена рассчитывает варианты", "Единое расчётное ядро подбирает автомобили и формирует понятную цену под ключ."],
  ["Заявка уходит подходящему дилеру", "Учитываются город, нужный рынок, загрузка, скорость ответа, рейтинг и качество работы."],
  ["Дилер ведёт сделку в CRM", "Менеджер работает с клиентом от первого ответа до покупки, доставки и выдачи автомобиля."],
  ["Платформа контролирует результат", "Статусы, сроки, подтверждение передачи автомобиля и комиссия только за завершённую сделку."],
] as const;

const freeFeatures = [
  "CRM для клиентов и заявок",
  "Сотрудники, роли и назначение обращений",
  "Расчёты автомобилей по всем рынкам",
  "Своя клиентская база без комиссии",
  "Базовая аналитика работы менеджеров",
];

const verifiedFeatures = [
  "Проверка компании и расчётного счёта",
  "Статус «Проверен АвтоЦена»",
  "Публичная карточка дилера",
  "Участие в распределении заявок",
  "Отзывы по подтверждённым сделкам",
  "Telegram-лента и приоритет в городе",
];

function Check({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-3 text-sm font-bold leading-6 text-white/68"><span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500 text-[11px] text-white">✓</span><span>{children}</span></li>;
}

function VerifiedIcon({ className = "" }: { className?: string }) {
  return (
    <span className={`dealer-verified-icon grid place-items-center rounded-full ${className}`} aria-label="Проверено АвтоЦена" title="Проверено АвтоЦена">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2.4L14.8 4L18 4.3L19.5 7.1L22.3 8.6L22 11.8L23.6 14.6L21.6 17.1L21.1 20.2L18 20.7L15.5 22.6L12.7 21L9.5 20.7L8 17.9L5.2 16.4L5.5 13.2L3.9 10.4L5.9 7.9L6.4 4.8L9.5 4.3L12 2.4Z" fill="currentColor" />
        <path d="M8.1 12.2L10.7 14.8L16.3 9.2" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default async function DealersLandingPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) || {};
  const sent = params.sent === "1";

  return (
    <main className="ac-dealers-page ac-page-copy min-h-screen bg-[#07080d] text-white">
      <PublicHeader backHref="/" backLabel="На главную" />

      <section className="relative overflow-hidden border-b border-white/7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(255,53,61,.22),transparent_34%),radial-gradient(circle_at_12%_18%,rgba(255,214,0,.08),transparent_24%)]" />
        <div className="relative mx-auto grid w-full max-w-[1500px] gap-10 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
          <div>
            <div className="text-sm font-black uppercase tracking-[.18em] text-red-400">АвтоЦена для дилеров</div>
            <h1 className="mt-4 max-w-5xl text-[43px] font-black leading-[.96] tracking-[-.055em] sm:text-6xl lg:text-[78px]">Первая CRM для компаний по привозу автомобилей</h1>
            <p className="mt-6 max-w-3xl text-base font-bold leading-7 text-white/62 md:text-xl md:leading-8">Ведите клиентов, управляйте менеджерами, рассчитывайте автомобили и получайте новые заявки в одной системе. АвтоЦена объединяет покупателей и проверенных дилеров по всей России.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#connect" className="dealer-primary-button rounded-2xl bg-[#ff353d] px-6 py-4 text-base font-black text-white transition hover:brightness-110">Подключиться бесплатно</a>
              <Link href="/dealers/demo" className="rounded-2xl bg-white px-6 py-4 text-base font-black text-black transition hover:scale-[1.02]">Посмотреть демо</Link>
              <a href="#how" className="rounded-2xl bg-white/[.075] px-6 py-4 text-base font-black text-white transition hover:bg-white/[.12]">Как это работает</a>
            </div>
            <div className="mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
              {[["0 ₽", "подключение CRM"], ["7", "рынков в расчёте"], ["1 500 ₽", "проверенный профиль"], ["Только факт", "комиссия с нашей сделки"]].map(([value, label]) => (
                <div key={label} className="dealer-metric-card rounded-2xl bg-white/[.055] p-4"><div className="text-xl font-black">{value}</div><div className="mt-1 text-xs font-bold leading-5 text-white/52">{label}</div></div>
              ))}
            </div>
          </div>
          <DealerHeroPreview />
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1500px] px-4 py-14 md:px-8 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-4xl">
            <div className="text-sm font-black uppercase tracking-[.18em] text-red-400">Не универсальная CRM</div>
            <h2 className="mt-3 text-4xl font-black tracking-[-.05em] md:text-6xl">Система уже понимает автомобильный бизнес</h2>
            <p className="mt-5 text-base font-bold leading-7 text-white/58 md:text-lg">Не нужно месяцами настраивать Bitrix или amoCRM. В АвтоЦена уже есть рынки, цена под ключ, таможня, утильсбор, автомобили в пути, выдача и готовая воронка компании по привозу авто.</p>
          </div>
          <Link href="/dealers/demo" className="rounded-2xl bg-white/[.08] px-5 py-3 text-sm font-black text-white">Открыть демо CRM →</Link>
        </div>
        <div className="mt-9 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {crmBenefits.map(([number, title, text]) => <article key={number} className="rounded-[1.6rem] bg-[#12151d] p-5 md:p-6"><div className="text-sm font-black text-red-400">{number}</div><h3 className="mt-3 text-2xl font-black tracking-[-.035em]">{title}</h3><p className="mt-3 text-sm font-bold leading-6 text-white/52">{text}</p></article>)}
        </div>
      </section>

      <section id="how" className="border-y border-white/7 bg-[#0c0e14]">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-14 md:px-8 md:py-20">
          <div className="max-w-4xl"><div className="text-sm font-black uppercase tracking-[.18em] text-red-400">Как Яндекс Еда, только в автотематике</div><h2 className="mt-3 text-4xl font-black tracking-[-.05em] md:text-6xl">АвтоЦена приводит клиента и управляет всей сделкой</h2></div>
          <div className="mt-9 grid gap-3 lg:grid-cols-5">
            {workflow.map(([title, text], index) => <article key={title} className="rounded-[1.6rem] bg-white/[.055] p-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-red-500 text-sm font-black text-white">{index + 1}</div><h3 className="mt-4 text-lg font-black">{title}</h3><p className="mt-3 text-sm font-bold leading-6 text-white/48">{text}</p></article>)}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1500px] gap-5 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-2">
        <article className="rounded-[2rem] bg-[#12151d] p-6 md:p-8"><div className="text-sm font-black uppercase tracking-[.16em] text-white/42">Бесплатно</div><h2 className="mt-3 text-4xl font-black tracking-[-.045em]">CRM для ежедневной работы</h2><p className="mt-4 text-sm font-bold leading-6 text-white/52">Дилер может вести собственную клиентскую базу и сотрудников без комиссии АвтоЦена.</p><ul className="mt-6 grid gap-3">{freeFeatures.map((item) => <Check key={item}>{item}</Check>)}</ul><a href="#connect" className="mt-7 inline-flex rounded-2xl bg-white px-5 py-3.5 text-sm font-black text-black">Начать бесплатно</a></article>
        <article className="dealer-verified-plan-card relative overflow-hidden rounded-[2rem] border border-red-500/35 bg-[linear-gradient(145deg,rgba(255,53,61,.18),rgba(18,21,29,1)_48%)] p-6 md:p-8">
          <VerifiedIcon className="absolute right-5 top-5 h-14 w-14" />
          <div className="pr-16 text-sm font-black uppercase tracking-[.16em] text-red-300">Проверенный дилер</div>
          <div className="mt-3 flex items-end gap-2"><div className="text-5xl font-black tracking-[-.05em]">1 500 ₽</div><div className="pb-1 text-sm font-bold text-white/58">в месяц</div></div>
          <p className="mt-4 text-sm font-bold leading-6 text-white/68">Подтверждённый профиль получает доверие клиентов и участвует в распределении заявок по своему городу.</p>
          <ul className="mt-6 grid gap-3">{verifiedFeatures.map((item) => <Check key={item}>{item}</Check>)}</ul>
          <div className="dealer-verified-plan-note mt-7 rounded-2xl bg-black/25 px-4 py-3 text-sm font-black text-white/82">Комиссия — только с клиента, которого привела АвтоЦена, и только после результата.</div>
        </article>
      </section>

      <section className="border-y border-white/7 bg-[#0c0e14]">
        <div className="mx-auto grid w-full max-w-[1500px] gap-8 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-2 lg:items-center">
          <div><div className="text-sm font-black uppercase tracking-[.18em] text-red-400">Профиль компании</div><h2 className="mt-3 text-4xl font-black tracking-[-.05em] md:text-6xl">Мини-сайт дилера внутри АвтоЦена</h2><p className="mt-5 text-base font-bold leading-7 text-white/56">Логотип, города, рынки, фотографии офиса и выдач, отзывы подтверждённых клиентов, рейтинг и новости из Telegram. На главной пользователь увидит проверенных дилеров именно в своём городе.</p></div>
          <div className="relative rounded-[2rem] bg-[#151821] p-5 md:p-7">
            <VerifiedIcon className="absolute right-5 top-5 h-12 w-12" />
            <div className="flex items-center gap-4"><div className="grid h-16 w-28 place-items-center rounded-2xl bg-[#0c0e14] p-3"><img src="/brands/topavto-logo.png" alt="TopAvto" className="max-h-full max-w-full object-contain" /></div><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-2xl font-black">TopAvto</h3><span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-black text-emerald-300">Проверен АвтоЦена</span></div><div className="mt-1 text-sm font-bold text-white/52">Новокузнецк · 6 рынков</div></div></div>
            <div className="mt-5 grid grid-cols-3 gap-2">{[["4,9", "рейтинг"], ["128", "выдач"], ["8 мин", "ответ"]].map(([value, label]) => <div key={label} className="rounded-2xl bg-white/[.065] p-3 text-center"><div className="text-xl font-black">{value}</div><div className="mt-1 text-[11px] font-bold text-white/48">{label}</div></div>)}</div>
            <div className="mt-3 rounded-2xl bg-white/[.065] p-4 text-sm font-bold leading-6 text-white/62">Новая выдача: автомобиль доставлен клиенту из Японии. Фото и публикация автоматически добавлены из Telegram-канала компании.</div>
          </div>
        </div>
      </section>

      <section id="connect" className="mx-auto grid w-full max-w-[1500px] gap-8 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[.8fr_1.2fr]">
        <div><div className="text-sm font-black uppercase tracking-[.18em] text-red-400">Пилотный запуск</div><h2 className="mt-3 text-4xl font-black tracking-[-.05em] md:text-6xl">Подключите свою компанию</h2><p className="mt-5 text-base font-bold leading-7 text-white/56">Первый пилот проходит на TopAvto. Следующие дилеры получат CRM, профиль компании и возможность первыми принимать заявки АвтоЦена в своём городе.</p><div className="mt-6 rounded-2xl bg-white/[.055] p-4 text-sm font-bold leading-6 text-white/56">После заявки мы свяжемся, подтвердим город и рынки, создадим рабочее пространство компании и поможем добавить менеджеров.</div></div>
        <form action="/api/dealers/apply" method="post" className="rounded-[2rem] bg-[#12151d] p-5 md:p-7">
          {sent ? <div className="mb-5 rounded-2xl bg-emerald-400/12 px-4 py-3 text-sm font-black text-emerald-300">Заявка принята. Свяжемся с вами для подключения пилота.</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2 text-xs font-black uppercase tracking-[.1em] text-white/42">Компания<input required name="companyName" className="rounded-2xl bg-white/[.07] px-4 py-3.5 text-sm font-black text-white outline-none focus:bg-white/[.1]" placeholder="Название компании" /></label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[.1em] text-white/42">Город<input required name="city" className="rounded-2xl bg-white/[.07] px-4 py-3.5 text-sm font-black text-white outline-none focus:bg-white/[.1]" placeholder="Город работы" /></label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[.1em] text-white/42">Ваше имя<input required name="contactName" className="rounded-2xl bg-white/[.07] px-4 py-3.5 text-sm font-black text-white outline-none focus:bg-white/[.1]" placeholder="Имя руководителя" /></label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[.1em] text-white/42">Телефон<input required name="phone" className="rounded-2xl bg-white/[.07] px-4 py-3.5 text-sm font-black text-white outline-none focus:bg-white/[.1]" placeholder="+7 999 000-00-00" /></label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[.1em] text-white/42">Telegram<input name="telegram" className="rounded-2xl bg-white/[.07] px-4 py-3.5 text-sm font-black text-white outline-none focus:bg-white/[.1]" placeholder="@username" /></label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[.1em] text-white/42">Сотрудников<input name="teamSize" type="number" min="1" className="rounded-2xl bg-white/[.07] px-4 py-3.5 text-sm font-black text-white outline-none focus:bg-white/[.1]" placeholder="Количество менеджеров" /></label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[.1em] text-white/42 md:col-span-2">С какими рынками работаете<textarea name="markets" rows={3} className="rounded-2xl bg-white/[.07] px-4 py-3.5 text-sm font-black normal-case tracking-normal text-white outline-none focus:bg-white/[.1]" placeholder="Япония, Китай, Корея, ОАЭ, Европа..." /></label>
          </div>
          <label className="mt-4 flex items-start gap-3 text-xs font-bold leading-5 text-white/44"><input required type="checkbox" name="consent" value="yes" className="mt-1" /><span>Согласен на обработку контактных данных для подключения компании к платформе АвтоЦена.</span></label>
          <button className="dealer-primary-button mt-5 w-full rounded-2xl bg-[#ff353d] px-5 py-4 text-base font-black text-white transition hover:brightness-110">Отправить заявку</button>
        </form>
      </section>

      <footer className="border-t border-white/7 px-4 py-8 text-center text-sm font-bold text-white/36"><Link href="/" className="hover:text-white">АвтоЦена</Link> · CRM, расчёты и новые клиенты для автомобильных дилеров</footer>
    </main>
  );
}
