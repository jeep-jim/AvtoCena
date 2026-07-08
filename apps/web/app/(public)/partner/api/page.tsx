import { PartnerShell } from "@/components/partner/PartnerShell";

export default function PartnerApiPage() {
  const example = `GET https://avtocena.com/api/cpa/postback?secret=SECRET&click_id={click_id}&partner_id={partner_id}&subid={subid}&status=signed_contract`;

  return (
    <PartnerShell title="CPA API" subtitle="Общая страница для подключения CPA-сетей, арбитражников и вебмастеров.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">Tracking URL</h2>
          <pre className="mt-4 overflow-auto rounded-2xl bg-black/40 p-4 text-sm text-white/72">https://avtocena.com/?ref={"{partner_id}"}&subid={"{subid}"}</pre>
          <h2 className="mt-6 text-2xl font-black">Postback</h2>
          <pre className="mt-4 overflow-auto rounded-2xl bg-black/40 p-4 text-sm text-white/72">{example}</pre>
        </div>
        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">События</h2>
          <div className="mt-4 space-y-3">
            {["visit", "calculation", "lead", "signed_contract", "paid"].map((event) => (
              <div key={event} className="rounded-2xl bg-white/7 px-4 py-3 font-black text-white/70">{event}</div>
            ))}
          </div>
          <a href="/api/cpa" className="mt-5 inline-block rounded-2xl bg-white px-5 py-4 font-black text-black">Открыть JSON API</a>
        </div>
      </div>
    </PartnerShell>
  );
}
