"use client";

import { useRef, useState } from "react";

function Field({ label, name, type = "text" }: { label: string; name: string; type?: string }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42">
      {label}
      <input name={name} type={type} className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-sm font-bold text-white placeholder:text-white/25 normal-case tracking-normal" />
    </label>
  );
}

function TextArea({ label, name, defaultValue = "" }: { label: string; name: string; defaultValue?: string }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42 md:col-span-2">
      {label}
      <textarea name={name} defaultValue={defaultValue} rows={4} className="soft-input min-w-0 rounded-xl px-3 py-2.5 text-sm font-bold text-white placeholder:text-white/25 normal-case tracking-normal" />
    </label>
  );
}

function nextOperationId() {
  return crypto.randomUUID();
}

export function ContractTemplateForm() {
  const [error, setError] = useState("");
  const operationIdRef = useRef<string>(typeof sessionStorage !== "undefined" ? sessionStorage.getItem("contractTemplateOperationId") || nextOperationId() : nextOperationId());
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem("contractTemplateOperationId", operationIdRef.current);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    formData.set("operationId", operationIdRef.current);
    const response = await fetch("/api/crm/settings/contracts", { method: "POST", body: formData });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload?.error || "contract_template_error");
      return;
    }
    operationIdRef.current = nextOperationId();
    sessionStorage.setItem("contractTemplateOperationId", operationIdRef.current);
    window.location.href = response.url || "/crm/settings#contracts";
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="operationId" value={operationIdRef.current} readOnly />
      <Field label="Название" name="title" />
      <Field label="Рынок" name="market" />
      <Field label="Версия" name="version" />
      <Field label="Effective from" name="effectiveFrom" type="datetime-local" />
      <label className="flex items-center gap-2 text-sm font-bold text-white/70"><input type="checkbox" name="active" /> Активен</label>
      <label className="flex items-center gap-2 text-sm font-bold text-white/70"><input type="checkbox" name="includeDirectorSignatureByDefault" /> Накладывать PNG-подпись</label>
      <TextArea label="Placeholders, по одному в строке" name="placeholdersText" />
      <TextArea label="Mapping: placeholder=client.phone" name="placeholderMappingText" />
      <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42">DOCX/PDF шаблон<input type="file" name="templateFile" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="text-sm normal-case" /></label>
      <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-white/42">PNG подпись<input type="file" name="signatureFile" accept="image/png" className="text-sm normal-case" /></label>
      <TextArea label="Комментарий" name="comment" />
      {error && <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm font-bold text-red-100 md:col-span-2">{error}</div>}
      <button className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white md:col-span-2">Сохранить метаданные шаблона</button>
    </form>
  );
}
