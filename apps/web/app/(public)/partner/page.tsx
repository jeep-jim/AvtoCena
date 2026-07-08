import { PartnerShell } from "@/components/partner/PartnerShell";
import { money } from "@/lib/avtocena";
import { readDataJson } from "@/lib/data";

export default async function PartnerPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const ref = Array.isArray(params.ref) ? params.ref[0] : params.ref || "demo";
  const partners = readDataJson<any[]>("partners/partners.json", []);
  const partner = partners.find((item) => item.code === ref) || partners[0] || { name: "Демо партнёр", code: ref, clicks: 421, calculations: 173, leads: 29, contracts: 11, balanceRub: 110000 };
  const link = `https://avtocena.com/?ref=${partner.code}`;

  return (
    <PartnerShell title="Личный кабинет" subtitle="Переходы, расчёты, заявки, договоры и выплаты по вашей партнёрской ссылке.">
      <div className="grid gap-4 md:grid-cols-5">
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Переходы</div><div className="mt-2 text-4xl font-black">{partner.clicks || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Расчёты</div><div className="mt-2 text-4xl font-black">{partner.calculations || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Заявки</div><div className="mt-2 text-4xl font-black">{partner.leads || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Договоры</div><div className="mt-2 text-4xl font-black">{partner.contracts || 0}</div></div>
        <div className="glass rounded-3xl p-5"><div className="text-sm font-bold text-white/45">Баланс</div><div className="mt-2 text-4xl font-black">{money(Number(partner.balanceRub || 0))} ₽</div></div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="glass rounded-[2rem] p-6">
          <h2 className="text-2xl font-black">Ваша ссылка</h2>
          <div className="mt-4 rounded-2xl bg-black/30 p-4 font-mono text-sm text-white/78">{link}</div>
          <p className="mt-4 text-sm font-bold text-white/55">Сейчас кабинет статический на JSON. Следующий шаг — сохраняем клики и события по ref/subid.</p>
        </div>
        <div className="glass rounded-[2rem] p-6 text-center">
          <div className="mx-auto grid h-48 w-48 place-items-center rounded-3xl bg-white text-center text-xl font-black text-black">
            QR<br />{partner.code}
          </div>
          <div className="mt-4 text-sm font-bold text-white/55">QR-заглушка. Подключим генерацию через qrcode.</div>
        </div>
      </div>
    </PartnerShell>
  );
}
