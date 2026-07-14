"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/crm";

type ManagerOption = {
  id: string;
  displayName: string;
};

type LeadActionsProps = {
  leadId: string;
  currentStatus?: string;
  currentManagerId?: string | null;
  managers: ManagerOption[];
};

export function LeadActions({
  leadId,
  currentStatus = "new",
  currentManagerId,
  managers,
}: LeadActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [assignedManagerId, setAssignedManagerId] = useState(currentManagerId || "");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const requiresReason = status === "rejected";

  async function save() {
    setSaved(false);
    setError("");

    if (requiresReason && !note.trim()) {
      setError(status === "rejected" ? "Укажите причину отказа." : "Укажите причину.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          assignedManagerId,
          note,
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (result?.error === "reason_required") {
          throw new Error("reason_required");
        }
        throw new Error("lead_update_error");
      }

      setSaved(true);
      setNote("");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message === "reason_required"
          ? "Для отказа причина обязательна."
          : "Не получилось сохранить изменения."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(170px,1fr)_minmax(180px,1.3fr)_auto] md:items-center">
      <select
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className="soft-input min-w-0 rounded-xl bg-zinc-950 px-3 py-2.5 text-xs font-bold text-white"
        aria-label="Статус заявки"
      >
        {LEAD_STATUSES.map((value) => (
          <option key={value} value={value}>
            {LEAD_STATUS_LABELS[value]}
          </option>
        ))}
      </select>

      <select
        value={assignedManagerId}
        onChange={(event) => setAssignedManagerId(event.target.value)}
        className="soft-input min-w-0 rounded-xl bg-zinc-950 px-3 py-2.5 text-xs font-bold text-white"
        aria-label="Назначенный менеджер"
      >
        <option value="">Не назначен</option>
        {managers.map((manager) => (
          <option key={manager.id} value={manager.id}>
            {manager.displayName}
          </option>
        ))}
      </select>

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={requiresReason ? "Причина обязательна" : "Внутренний комментарий"}
        className="soft-input min-w-0 rounded-xl bg-zinc-950 px-3 py-2.5 text-xs font-bold text-white"
      />

      <button
        type="button"
        onClick={save}
        disabled={loading}
        className="rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Сохраняем..." : "Сохранить"}
      </button>

      {(saved || error) && (
        <div className={`text-xs font-bold md:col-span-4 ${error ? "text-red-200" : "text-green-200"}`}>
          {error || "Изменения сохранены"}
        </div>
      )}
    </div>
  );
}
