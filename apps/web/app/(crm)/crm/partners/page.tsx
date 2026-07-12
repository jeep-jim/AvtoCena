import { CrmShell } from "@/components/crm/CrmShell";
import { PayoutRequestActions } from "@/components/crm/PayoutRequestActions";
import { readChunkedDataJson, readDataJson } from "@/lib/data";
import { money } from "@/lib/avtocena";

type PayoutRequest = {
  id: string;
  createdAt: string;
  partnerCode: string;
  partnerName: string;
  telegram?: string | null;
  amountRub: number;
  status: "pending" | "approved" | "paid" | "rejected";
  comment?: string | null;
};

function statusLabel(status: PayoutRequest["status"]) {
  if (status === "approved") return "Одобрено";
  if (status === "paid") return "Выплачено";
  if (status === "rejected") return "Отклонено";
  return "На проверке";
}

export default function CrmPartnersPage() {
  const partners = readDataJson<any[]>("partners/partners.json", []);
  const payoutRequests = readChunkedDataJson<PayoutRequest>(
    "partners/payout-requests.json",
    [],
  );

  return (
    <CrmShell
      activeHref="/crm/partners"
      title="Партнёры"
      subtitle="Прямые партнёры и CPA-источники. Внутренняя CRM остаётся доступна только сотрудникам компании."
    >
      <div className="glass overflow-hidden rounded-[2rem]">
        <div className="hidden grid-cols-5 gap-3 border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.14em] text-white/42 md:grid">
          <div>Партнёр</div>
          <div>Код</div>
          <div>Переходы</div>
          <div>Договоры</div>
          <div>К выплате</div>
        </div>
        {partners.map((partner) => (
          <div
            key={partner.id}
            className="grid min-w-0 gap-3 border-b border-white/7 p-4 text-sm font-bold text-white/70 last:border-0 sm:grid-cols-2 md:grid-cols-5"
          >
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                Партнёр
              </div>
              <div className="mt-1 break-words text-white">{partner.name}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                Код
              </div>
              <div className="mt-1 break-all">{partner.code || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                Переходы
              </div>
              <div className="mt-1">{partner.clicks || 0}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                Договоры
              </div>
              <div className="mt-1">{partner.contracts || 0}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                К выплате
              </div>
              <div className="mt-1 text-white">
                {money(Number(partner.balanceRub || 0))} ₽
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass mt-5 overflow-hidden rounded-[2rem]">
        <div className="border-b border-white/10 p-5">
          <h2 className="text-2xl font-black">Запросы выплат</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-white/45">
            Только для прямых партнёров. CPA-сети закрываются отдельным реестром.
          </p>
        </div>

        {payoutRequests.map((request) => (
          <div
            key={request.id}
            className="grid min-w-0 gap-3 border-b border-white/7 p-5 last:border-0 md:grid-cols-[minmax(0,1.1fr)_150px_130px_minmax(0,1fr)] md:items-center"
          >
            <div className="min-w-0">
              <div className="break-words font-black text-white">
                {request.partnerName || request.partnerCode}
              </div>
              <div className="mt-1 break-all text-xs font-bold text-white/42">
                {request.telegram || request.partnerCode}
              </div>
              {request.comment ? (
                <div className="mt-2 text-sm font-bold leading-6 text-white/52">
                  {request.comment}
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                Сумма
              </div>
              <div className="mt-1 font-black text-white">
                {money(Number(request.amountRub || 0))} ₽
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.12em] text-white/30 md:hidden">
                Статус
              </div>
              <span className="mt-1 inline-flex rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-xs font-black text-white/72">
                {statusLabel(request.status)}
              </span>
            </div>
            <PayoutRequestActions requestId={request.id} status={request.status} />
          </div>
        ))}

        {!payoutRequests.length ? (
          <div className="p-8 text-center text-sm font-bold text-white/48">
            Запросов выплаты пока нет.
          </div>
        ) : null}
      </div>
    </CrmShell>
  );
}
