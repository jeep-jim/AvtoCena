"use client";

import { LeadStatusHelp } from "./LeadStatusHelp";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEAD_STATUSES, leadStatusOptionLabel, leadMetrikaStage } from "@/lib/crm";

type ManagerOption = {
  id: string;
  displayName: string;
};

type LeadActionsProps = {
  leadId: string;
  currentStatus?: string;
  currentManagerId?: string | null;
  managers: ManagerOption[];
  canAssignManagers?: boolean;
  archived?: boolean;
};

export function LeadActions({
  leadId,
  currentStatus = "new",
  currentManagerId,
  managers,
  canAssignManagers = false,
  archived = false,
}: LeadActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [assignedManagerId, setAssignedManagerId] = useState(currentManagerId || "");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const metrikaStage = leadMetrikaStage(status);
  const requiresReason = status === "rejected" || status === "duplicate" || status === "spam";
  const currentManagerName = managers.find((manager) => manager.id === assignedManagerId)?.displayName || "Вы";

  async function archive() {
    const reason=archived ? "Восстановлена из архива" : window.prompt("Причина архивации", "Тест");
    if(!reason?.trim())return;
    setLoading(true);setError("");
    try {const response=await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({archived:!archived,note:reason})});if(!response.ok)throw Error();router.refresh();}catch{setError("Не удалось изменить архив. Повторите попытку.");}finally{setLoading(false);}
  }

  async function save() {
    setSaved(false);
    setError("");

    if (requiresReason && !note.trim()) {
      setError(status === "rejected" ? "Укажите причину отказа." : status === "spam" ? "Укажите причину пометки спамом." : "Укажите причину дубля.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          assignedManagerId: canAssignManagers ? assignedManagerId : undefined,
          expectedManagerId: canAssignManagers ? currentManagerId || null : undefined,
          note,
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (result?.error === "assignment_conflict") throw new Error("assignment_conflict");
        if (result?.error === "reason_required") throw new Error("reason_required");
        if (result?.error === "lead_forbidden" || result?.error === "manager_assignment_forbidden") throw new Error("forbidden");
        throw new Error("lead_update_error");
      }

      setSaved(true);
      setNote("");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message === "assignment_conflict"
          ? "Ответственный уже изменён другим сотрудником. Обновите страницу."
          : saveError instanceof Error && saveError.message === "reason_required"
          ? "Для отказа, дубля или спама причина обязательна."
          : saveError instanceof Error && saveError.message === "forbidden"
            ? "У вас нет прав на изменение этой заявки или её менеджера."
            : "Не получилось сохранить изменения."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="crm-lead-actions grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(170px,1fr)_minmax(180px,1.3fr)_auto] md:items-center">
      <div className="crm-status-picker">
      <select
        data-metrika-stage={metrikaStage?.tone}
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-xs font-bold"
        aria-label="Статус заявки"
      >
        {LEAD_STATUSES.map((value) => (
          <option key={value} value={value}>
            {leadStatusOptionLabel(value)}
          </option>
        ))}
      </select>
      <LeadStatusHelp status={status} />
      </div>

      {canAssignManagers ? (
        <select
          value={assignedManagerId}
          onChange={(event) => setAssignedManagerId(event.target.value)}
          className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-xs font-bold"
          aria-label="Назначенный менеджер"
        >
          <option value="">Не назначен</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.displayName}
            </option>
          ))}
        </select>
      ) : (
        <div className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-xs font-bold text-white/70">
          Менеджер: {currentManagerName}
        </div>
      )}

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={requiresReason ? "Причина обязательна" : "Внутренний комментарий"}
        className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-xs font-bold"
      />

      <button
        type="button"
        onClick={save}
        disabled={loading}
        className="rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Сохраняем..." : "Сохранить"}
      </button>

      {metrikaStage && <p className="crm-metrika-lead-hint col-span-2 md:col-span-4" data-metrika-stage={metrikaStage.tone}>
        <strong>{metrikaStage.marker} Цель Метрики: {metrikaStage.name}.</strong>{' '}
        {status === 'spam' ? 'Спам — сигнал о некачественной заявке. Отсутствие ответа само по себе не спам. ' : ''}
        После сохранения статус попадёт в фоновую отправку при включённой интеграции и наличии ClientID. Эта отметка не подтверждает доставку в Метрику.
      </p>}
      {canAssignManagers && <button disabled={loading} onClick={archive} className="rounded-xl border border-[var(--ac-border)] px-4 py-2 text-xs font-bold md:col-span-4">{archived ? "Восстановить заявку" : "Убрать в архив"}</button>}

      {(saved || error) && (
        <div className={`text-xs font-bold md:col-span-4 ${error ? "text-red-200" : "text-green-200"}`}>
          {error || "Изменения сохранены"}
        </div>
      )}
    </div>
  );
}
