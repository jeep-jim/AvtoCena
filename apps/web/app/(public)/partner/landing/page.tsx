import { PartnerShell } from "@/components/partner/PartnerShell";
import { PartnerAccessModal } from "@/components/partner/PartnerAccessModal";
import { money } from "@/lib/avtocena";
import { getActiveSiteBusinessVersion } from "@/lib/business-settings";

type RequestState = "sent" | "duplicate" | "error" | undefined;

const offerPoints = [
  "Личная ссылка и QR",
  "Кабинет со статистикой переходов и лидов",
  "Статусы заявок и договоров",
  "S2S / Postback для CPA-сетей",
  "Сайт + PWA + Telegram Mini App",
  "Менеджеры TopAvto доводят клиента до сделки",
];

const featureCards = [
  {
    emoji: "💰",
    title: "Высокий payout",
    text: "Выплата за подписанный договор — актуальная ставка из партнёрской программы. Работаете не за клик, а за реальный результат.",
  },
  {
    emoji: "🌍",
    title: "Широкий оффер",
    text: "Япония, Китай, Корея, ОАЭ и Европа. Несколько рынков дают больше сценариев и шире охват аудитории.",
  },
  {
    emoji: "🤝",
    title: "Дожим менеджерами",
    text: "Заявка не остаётся без внимания: менеджеры TopAvto берут клиента в работу, комментируют отказ и ведут до договора.",
  },
  {
    emoji: "🔗",
    title: "Под CPA и вебмастеров",
    text: "Готовим удобный кабинет, реферальные ссылки, postback, статусы, дедупликацию и прозрачную отчётность.",
  },
];

const sourceChips = [
  "CPA-сети",
  "Арбитраж",
  "Telegram",
  "YouTube",
  "VK",
  "Авто-сообщества",
];

const heroProofCards = [
  { image: "/buyers/3.jpg", title: "Реальные доставки TopAvto" },
  { image: "/buyers/7.jpg", title: "Авто под бюджет клиента" },
  { image: "/buyers/12.jpg", title: "Менеджеры закрывают в договор" },
];

const conversionProofCards = [
  {
    image: "/buyers/2.jpg",
    title: "Живые кейсы и доверие",
    text: "Показываем не стоковые изображения, а реальные автомобили и клиентов TopAvto.",
  },
  {
    image: "/buyers/9.jpg",
    title: "Разные бюджеты и форматы",
    text: "Широкий выбор рынков и автомобилей помогает охватывать разные сегменты аудитории.",
  },
  {
    image: "/buyers/15.jpg",
    title: "Понятный путь до выплаты",
    text: "Вебмастер видит движение лида, а менеджеры TopAvto ведут клиента до подписанного договора.",
  },
];

const steps = [
  "Получаете одобрение, доступ и личную ссылку вида avtocena.com/?ref=your_code",
  "Запускаете трафик: CPA-сеть, арбитраж, блог, Telegram или собственную площадку",
  "Пользователь узнаёт АвтоЦену, оставляет заявку и попадает в воронку TopAvto",
  "Менеджеры ведут клиента, а вы видите статусы, лиды и начисления в кабинете",
];

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function GlowPill({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-full border border-white/12 bg-white/[0.055] px-3 py-2 text-xs font-black text-white/75 backdrop-blur">
      {children}
    </div>
  );
}

function ProfitabilityBlock() {
  return (
    <div className="glass rounded-[2rem] p-6 md:p-8">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
        Почему это выгодно
      </div>
      <h2 className="mt-3 text-[30px] font-black leading-[0.98] tracking-[-0.04em] text-white md:text-[42px]">
        Оффер, который легко объяснить и приятно продвигать
      </h2>

      <div className="mt-6 grid auto-rows-fr gap-3 md:grid-cols-2">
        {featureCards.map((item) => (
          <div
            key={item.title}
            className="flex min-h-[190px] flex-col rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="text-lg font-black leading-6 text-white">{item.title}</div>
              <div className="shrink-0 text-[30px] leading-none" aria-hidden="true">
                {item.emoji}
              </div>
            </div>
            <p className="mt-4 text-sm font-medium leading-7 text-white/60">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[1.6rem] border border-red-300/14 bg-[linear-gradient(135deg,rgba(239,68,68,0.12),rgba(255,255,255,0.04))] p-5">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-red-200/90">
          Что важно для CPA-сети
        </div>
        <div className="mt-3 grid gap-2 text-sm font-bold text-white/72 md:grid-cols-2">
          {[
            "прозрачные статусы лидов",
            "причины отклонения",
            "server-to-server postback",
            "атрибуция click_id / sub1-sub5",
            "дедупликация событий",
            "видимость выплат и холда",
          ].map((item) => (
            <div key={item} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccessBlock({ requestState }: { requestState: RequestState }) {
  return (
    <div className="glass rounded-[2rem] p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
            Доступ партнёра
          </div>
          <h2 className="mt-3 text-[30px] font-black leading-[0.98] tracking-[-0.04em] text-white md:text-[42px]">
            Получите доступ к офферу
          </h2>
        </div>
        <div className="hidden max-w-[130px] shrink-0 rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-center text-xs font-black leading-4 text-white/72 lg:block">
          ручная модерация
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {offerPoints.map((item) => (
          <div key={item} className="rounded-2xl bg-white/[0.045] px-4 py-4 font-bold text-white/70">
            {item}
          </div>
        ))}
      </div>

      {requestState === "sent" ? (
        <div className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm font-bold leading-6 text-emerald-100">
          Заявка отправлена. Мы проверим источник трафика и напишем вам в Telegram. Доступ, личная ссылка и ключ создаются только после согласования.
        </div>
      ) : null}

      {requestState === "duplicate" ? (
        <div className="mt-6 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm font-bold leading-6 text-amber-100">
          Заявка с этим Telegram уже находится на рассмотрении. Мы свяжемся с вами после проверки.
        </div>
      ) : null}

      {requestState === "error" ? (
        <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm font-bold leading-6 text-red-100">
          Не удалось отправить заявку. Проверьте обязательные поля и попробуйте ещё раз.
        </div>
      ) : null}

      <div className="mt-6 border-t border-white/10 pt-6">
        <PartnerAccessModal />
        <p className="mt-3 text-xs font-bold leading-5 text-white/38">
          Доступ выдаём после ручной проверки источника трафика. После одобрения создадим кабинет, личную ссылку и ключ.
        </p>
      </div>
    </div>
  );
}

function HowItWorksBlock() {
  return (
    <div id="how-it-works" className="glass rounded-[2rem] p-6 md:p-8">
      <h2 className="text-[30px] font-black leading-[0.98] tracking-[-0.04em] text-white md:text-[42px]">
        Как это работает
      </h2>
      <div className="mt-5 space-y-4">
        {steps.map((step, index) => (
          <div key={step} className="flex gap-3 rounded-2xl bg-white/7 p-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500 text-sm font-black text-white">
              {index + 1}
            </div>
            <div className="font-bold leading-7 text-white/72">{step}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConversionBlock() {
  return (
    <div className="glass rounded-[2rem] p-6 md:p-8">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
        Почему страница будет конвертить
      </div>
      <h2 className="mt-3 text-[30px] font-black leading-[0.98] tracking-[-0.04em] text-white md:text-[42px]">
        Визуал, доверие и понятный оффер
      </h2>
      <p className="mt-4 max-w-3xl text-sm font-medium leading-7 text-white/60 md:text-base">
        Партнёр читает не сухую справку, а коммерческий лендинг: видно оффер, payout, преимущества работы с вами и логику монетизации. Это важно и для CPA-сетей, и для вебмастеров, которым нужно быстро понять, стоит ли тестировать трафик.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {conversionProofCards.map((item) => (
          <div key={item.title} className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.045]">
            <div className="aspect-[4/3] overflow-hidden">
              <img
                src={item.image}
                alt={item.title}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="p-4">
              <div className="text-base font-black leading-6 text-white">{item.title}</div>
              <p className="mt-2 text-sm font-medium leading-6 text-white/58">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function PartnerLandingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const requestState = firstParam(params.request) as RequestState;
  const siteBusiness = getActiveSiteBusinessVersion();
  const partnerPayoutRub = Number(siteBusiness?.displayPartnerPayoutRub || 10000);

  return (
    <PartnerShell
      title="Зарабатывайте на заявках АвтоЦена"
      subtitle="Партнёрская страница для CPA-сетей, вебмастеров и арбитражников. Вы приводите клиента на расчёт авто под бюджет, а TopAvto берёт на себя обработку, подбор автомобиля и доведение до договора."
    >
      <div className="space-y-6 md:space-y-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] md:p-8 xl:p-10">
          <div className="pointer-events-none absolute -left-12 top-0 h-48 w-48 rounded-full bg-red-500/20 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-6 h-44 w-44 rounded-full bg-amber-300/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-32 rounded-full bg-blue-500/10 blur-3xl" />

          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_500px] xl:items-center">
            <div>
              <div className="flex flex-wrap gap-2">
                <GlowPill>{money(partnerPayoutRub)} ₽ за подписанный договор</GlowPill>
                <GlowPill>S2S / postback</GlowPill>
                <GlowPill>CPA + прямые партнёры</GlowPill>
              </div>

              <h2 className="mt-5 max-w-4xl text-[36px] font-black leading-[0.95] tracking-[-0.045em] text-white md:text-[52px] xl:text-[64px]">
                Красивый оффер для трафика,
                <span className="block text-red-400">понятная монетизация для партнёра</span>
              </h2>

              <p className="mt-5 max-w-3xl text-[15px] font-medium leading-7 text-white/68 md:text-[17px] md:leading-8">
                АвтоЦена — это не просто форма заявки. Это вход в реальный авто-оффер: пользователь быстро понимает, что можно привезти под его бюджет, а ваш трафик превращается в заявки, которые команда TopAvto дожимает до договора.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <PartnerAccessModal openByDefault={requestState === "error"} />
                <a href="#how-it-works" className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.05] px-6 py-4 font-black text-white/76 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white">
                  Как работает оффер
                </a>
              </div>

              <div className="mt-6 flex flex-wrap gap-2.5">
                {sourceChips.map((chip) => (
                  <span key={chip} className="rounded-full border border-red-300/18 bg-red-500/8 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-red-100/92">
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative border-t border-white/10 pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
              <div className="pointer-events-none absolute -right-4 bottom-8 h-24 w-24 rounded-full bg-red-500/16 blur-3xl" />
              <div className="relative">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-red-200/85">Модель заработка</div>
                    <div className="mt-2 whitespace-nowrap text-[46px] font-black leading-none tracking-[-0.06em] text-white sm:text-5xl">{money(partnerPayoutRub)} ₽</div>
                    <div className="mt-2 text-sm font-black text-white/68">за подписанный договор</div>
                  </div>
                  <div className="w-fit rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100">Прозрачная статистика</div>
                </div>

                <div className="mt-6 border-y border-white/10">
                  {[
                    ["🖱️ Клик и атрибуция", "click_id · ref · sub1-sub5"],
                    ["📝 Лид", "заявка клиента попадает в CRM"],
                    ["📊 Статусы", "в работе · отказ · договор"],
                    ["💸 Выплата", "начисление после подписания"],
                  ].map(([label, value], index) => (
                    <div key={label} className={["grid gap-1 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4", index < 3 ? "border-b border-white/10" : ""].join(" ")}>
                      <div className="text-sm font-black text-white">{label}</div>
                      <div className="text-xs font-bold leading-5 text-white/55 sm:max-w-[210px] sm:text-right">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(138px,1fr))] gap-3">
                  {heroProofCards.map((item, index) => (
                    <div key={item.title} className="min-w-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.035]">
                      <div className="aspect-[4/3] w-full overflow-hidden">
                        <img
                          src={item.image}
                          alt={item.title}
                          loading={index === 0 ? "eager" : "lazy"}
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="p-3"><div className="min-h-[40px] text-sm font-black leading-5 text-white">{item.title}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid items-start gap-5 xl:grid-cols-2">
          <div className="space-y-5">
            <ProfitabilityBlock />
            <HowItWorksBlock />
          </div>
          <div className="space-y-5">
            <AccessBlock requestState={requestState} />
            <ConversionBlock />
          </div>
        </section>
      </div>
    </PartnerShell>
  );
}
