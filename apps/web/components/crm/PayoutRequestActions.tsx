"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PayoutStatus = "pending" | "approved" | "paid" | "rejected";

export function PayoutRequestActions({
  requestId,
  status,
}: {
  requestId: string;
  status: PayoutStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function updateStatus(nextStatus: PayoutStatus) {
    if (busy || nextStatus === status) return;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/crm/partners/payout-requests/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) throw new Error("Не удалось изменить статус");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка обновления");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2">
        {status === "pending" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => updateStatus("approved")}
            className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-100 disabled:opacity-50"
          >
            Одобрить
          </button>
        ) : null}
        {status === "approved" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => updateStatus("paid")}
            className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
          >
            Выплачено
          </button>
        ) : null}
        {status !== "paid" && status !== "rejected" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => updateStatus("rejected")}
            className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs font-black text-white/65 disabled:opacity-50"
          >
            Отклонить
          </button>
        ) : null}
        {status === "rejected" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => updateStatus("pending")}
            className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs font-black text-white/65 disabled:opacity-50"
          >
            Вернуть на проверку
          </button>
        ) : null}
      </div>
      {error ? <div className="mt-2 text-xs font-bold text-red-200">{error}</div> : null}
    </div>
  );
}
