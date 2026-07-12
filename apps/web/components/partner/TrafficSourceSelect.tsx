"use client";

import { useEffect, useRef, useState } from "react";

const trafficSourceOptions = [
  { value: "webmaster", label: "Вебмастер / арбитражник" },
  { value: "blogger", label: "Блогер / владелец сообщества" },
  { value: "business", label: "Автобизнес / представитель" },
  { value: "cpa-network", label: "CPA-сеть" },
  { value: "other", label: "Другое" },
] as const;

export function TrafficSourceSelect() {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = trafficSourceOptions.find(
    (option) => option.value === value,
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function selectOption(nextValue: string) {
    setValue(nextValue);
    setInvalid(false);
    setOpen(false);
    inputRef.current?.setCustomValidity("");
  }

  return (
    <div
      ref={rootRef}
      className={["relative min-w-0", open ? "z-[180]" : "z-0"].join(" ")}
    >
      <input
        ref={inputRef}
        type="text"
        name="trafficSource"
        value={value}
        onChange={() => undefined}
        required
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px opacity-0"
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          setOpen(true);
        }}
      />

      <button
        id="partner-source"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid}
        className={[
          "soft-input flex h-14 w-full min-w-0 items-center justify-between gap-3 rounded-2xl border bg-white/[0.055] px-4 text-left font-bold text-white outline-none transition",
          open
            ? "rounded-b-none border-red-400/55 bg-[#23252e]"
            : invalid
              ? "border-red-400/75"
              : "border-white/12 hover:border-white/22 hover:bg-white/[0.07]",
        ].join(" ")}
      >
        <span
          className={
            selectedOption
              ? "min-w-0 truncate text-white"
              : "min-w-0 truncate text-white/62"
          }
        >
          {selectedOption?.label ?? "Выберите вариант"}
        </span>

        <svg
          width="13"
          height="8"
          viewBox="0 0 14 9"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={[
            "shrink-0 opacity-70 transition",
            open ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden="true"
        >
          <path
            d="M1 1.5L7 7.5L13 1.5"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%-1px)] z-[180] overflow-hidden rounded-b-2xl border border-t-0 border-red-400/45 bg-[#171922] shadow-[0_24px_80px_rgba(0,0,0,0.72)]"
          role="listbox"
          aria-label="Источник трафика"
        >
          <div className="grid gap-1 p-1.5">
            {trafficSourceOptions.map((option) => {
              const active = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => selectOption(option.value)}
                  className={[
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-[0.78rem] px-3 py-2 text-left text-[14px] font-bold transition",
                    active
                      ? "bg-red-500 text-white"
                      : "text-white/76 hover:bg-white/[0.07] hover:text-white",
                  ].join(" ")}
                >
                  <span className="min-w-0 truncate">{option.label}</span>

                  {active ? (
                    <svg
                      width="15"
                      height="12"
                      viewBox="0 0 15 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M1.5 6.2L5.2 10L13.5 1.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {invalid ? (
        <p className="mt-2 text-xs font-bold text-red-200">
          Выберите, откуда планируете привлекать трафик.
        </p>
      ) : null}
    </div>
  );
}
