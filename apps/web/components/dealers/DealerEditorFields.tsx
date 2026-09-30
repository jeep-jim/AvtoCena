"use client";
import {useState} from "react";
import type {DealerPhoto} from "@/lib/dealers/showcase-model";
export const input = "soft-input w-full min-w-0 rounded-xl p-3 text-sm";
export const button =
  "rounded-xl border border-[var(--ac-border)] px-4 py-2 text-sm font-bold disabled:opacity-40";
export function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: any) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input
        className={input}
        type={type}
        value={value}
        step={type === "number" ? "any" : undefined}
        onChange={(e) =>
          onChange(type === "number" ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-[var(--ac-border)] p-3">
      <input
        className="h-5 w-5 accent-red-500"
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
export function Photos({
  dealerId,
  value,
  onChange,
  single = false,
}: {
  dealerId: string;
  value: DealerPhoto[];
  onChange: (p: DealerPhoto[]) => void;
  single?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState("");
  async function upload(files?: FileList | null) {
    setBusy(true);
    setError("");
    try {
      const added: DealerPhoto[] = [];
      for (const file of files ? Array.from(files) : [null]) {
        const data = new FormData();
        if (file) data.set("file", file);
        else data.set("url", url);
        const r = await fetch(`/api/crm/dealers/${dealerId}/media`, {
          method: "POST",
          body: data,
        });
        const result = await r.json();
        if (!r.ok) throw Error(result.error);
        added.push(result);
      }
      onChange(single ? added.slice(-1) : [...value, ...added]);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.map((p, i) => (
          <div key={`${p.id}-${i}`} className="w-28">
            <img
              className="h-20 w-28 rounded-xl object-cover"
              src={p.url}
              alt={p.caption || `Фото ${i + 1}`}
            />
            <div className="flex justify-between text-xs">
              <button
                type="button"
                disabled={busy || i === 0}
                onClick={() => {
                  const next = [...value];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange(next);
                }}
              >
                ←
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChange(value.filter((_, n) => n !== i))}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
      <input
        aria-label="Загрузить фотографии"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={!single}
        disabled={busy}
        onChange={(e) => void upload(e.target.files)}
        className="max-w-full text-sm"
      />
      <div className="flex gap-2">
        <input
          className={input}
          type="url"
          aria-label="Ссылка на изображение"
          placeholder="https://… — ссылка на фото"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !url}
          className={button}
          onClick={() => void upload()}
        >
          Загрузить
        </button>
      </div>
      <p className="text-xs text-[var(--ac-muted)]">
        {busy
          ? "Загружаем…"
          : "JPG, PNG, WebP до 8 МБ. Первое фото будет обложкой."}
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
