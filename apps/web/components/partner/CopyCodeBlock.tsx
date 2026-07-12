"use client";

import { useState } from "react";

type CopyCodeBlockProps = {
  label: string;
  value: string;
  hint?: string;
};

export function CopyCodeBlock({ label, value, hint }: CopyCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-w-0 rounded-[1.25rem] border border-white/10 bg-black/25 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-white/42">
            {label}
          </div>
          {hint ? (
            <div className="mt-1 text-xs font-bold leading-5 text-white/38">
              {hint}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={copyValue}
          className="shrink-0 rounded-full border border-white/12 bg-white/[0.055] px-3 py-2 text-xs font-black text-white/72 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>

      <code className="mt-3 block max-w-full whitespace-pre-wrap break-all rounded-2xl bg-[#0b0d14] p-3 font-mono text-[12px] leading-6 text-white/78 sm:p-4 sm:text-[13px]">
        {value}
      </code>
    </div>
  );
}
