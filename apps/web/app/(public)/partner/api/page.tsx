import type { Metadata } from "next";
import { PartnerShell } from "@/components/partner/PartnerShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CPA API — АвтоЦена",
  robots: { index: false, follow: false }
};

export default function PartnerApiPage() {
  const example = `GET https://avtocena.com/api/cpa/postback?secret=SECRET&click_id={click_id}&partner_id={partner_id}&subid={subid}&status=signed_contract`;

  return (
    <PartnerShell title="CPA API" subtitle="Закрытая страница для CPA-сетей и крупных партнёров. Публично не индексируется и открывается только по доступу.">
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="glass rounded-[2rem] p-5 md:p-6">
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100">
            Не публикуем эту страницу в меню и поиске. Доступ выдаётся вручную партнёрам или по секретному ключу.
          </div>

          <h2 className="mt-6 text-2xl font-black">Tracking URL</h2>
          <pre className="mt-4 overflow-auto rounded-2xl bg-black/40 p-4 text-sm text-white/72">https://avtocena.com/?ref={"{partner_id}"}&subid={"{subid}"}</pre>

          <h2 className="mt-6 text-2xl font-black">Postback</h2>
          <pre className="mt-4 overflow-auto rounded-2xl bg-black/40 p-4 text-sm text-white/72">{example}</pre>
        </div>

        <div className="glass rounded-[2rem] p-5 md:p-6">
          <h2 className="text-2xl font-black">События</h2>
          <div className="mt-4 space-y-3">
            {[
              ["visit", "переход по ссылке"],
              ["calculation", "расчёт АвтоЦены"],
              ["lead", "заявка"],
              ["signed_contract", "подписан договор"],
              ["paid", "выплата"]
            ].map(([event, text]) => (
              <div key={event} className="rounded-2xl bg-white/7 px-4 py-3">
                <div className="font-black text-white/80">{event}</div>
                <div className="mt-1 text-sm font-bold text-white/42">{text}</div>
              </div>
            ))}
          </div>
          <a href="/api/cpa" className="mt-5 inline-block rounded-2xl bg-white px-5 py-4 font-black text-black">Открыть JSON API</a>
        </div>
      </div>
    </PartnerShell>
  );
}
