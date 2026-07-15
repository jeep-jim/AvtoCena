"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TrafficSourceSelect } from "@/components/partner/TrafficSourceSelect";

export function PartnerAccessModal({
  openByDefault = false,
}: {
  openByDefault?: boolean;
}) {
  const [open, setOpen] = useState(openByDefault);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const modal =
    mounted && open
      ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/78 p-0 backdrop-blur-md sm:items-center sm:p-5"
            role="dialog"
            aria-modal="true"
            aria-label="Заявка на доступ к партнёрской программе"
            onClick={() => setOpen(false)}
          >
            <div
              className="ac-partner-modal max-h-[100dvh] w-full overflow-y-auto rounded-t-[2rem] border border-white/12 bg-[#10121a] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.72)] sm:max-w-2xl sm:rounded-[2rem] sm:p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
                    Партнёрская программа
                  </div>
                  <h2 className="mt-2 text-[28px] font-black leading-none tracking-[-0.04em] text-white sm:text-[36px]">
                    Запросить доступ
                  </h2>
                  <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-white/58">
                    Расскажите, кто вы и откуда планируете трафик. После проверки мы напишем в Telegram и выдадим доступ, ссылку и ключ.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] text-xl text-white/72 transition hover:bg-white/[0.1] hover:text-white"
                  aria-label="Закрыть форму"
                >
                  ×
                </button>
              </div>

              <form action="/api/partners" method="post" className="mt-6 grid gap-4">
                <div>
                  <label
                    htmlFor="partner-name"
                    className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/52"
                  >
                    Имя или название команды
                  </label>
                  <input
                    id="partner-name"
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    placeholder="Как к вам обращаться"
                    className="soft-input h-14 w-full rounded-2xl border border-white/12 bg-white/[0.055] px-4 font-bold text-white outline-none placeholder:text-white/28 focus:border-red-400/55"
                  />
                </div>

                <div>
                  <label
                    htmlFor="partner-telegram"
                    className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/52"
                  >
                    Telegram username
                  </label>
                  <input
                    id="partner-telegram"
                    name="telegram"
                    required
                    maxLength={80}
                    autoComplete="username"
                    placeholder="@username"
                    className="soft-input h-14 w-full rounded-2xl border border-white/12 bg-white/[0.055] px-4 font-bold text-white outline-none placeholder:text-white/28 focus:border-red-400/55"
                  />
                </div>

                <div>
                  <label
                    htmlFor="partner-source"
                    className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/52"
                  >
                    Кто вы и откуда планируете трафик
                  </label>
                  <TrafficSourceSelect />
                </div>

                <div>
                  <label
                    htmlFor="partner-comment"
                    className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/52"
                  >
                    Коротко о вашем трафике
                  </label>
                  <textarea
                    id="partner-comment"
                    name="comment"
                    rows={4}
                    maxLength={1200}
                    placeholder="Площадки, примерный объём, GEO или ссылка на источник"
                    className="soft-input w-full resize-y rounded-2xl border border-white/12 bg-white/[0.055] px-4 py-3 font-bold text-white outline-none placeholder:text-white/28 focus:border-red-400/55"
                  />
                </div>

                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  className="hidden"
                  aria-hidden="true"
                />

                <button
                  type="submit"
                  className="avto-button flex min-h-14 items-center justify-center rounded-2xl px-6 py-4 font-black"
                >
                  Отправить заявку
                </button>

                <p className="text-xs font-bold leading-5 text-white/38">
                  Заявка попадёт команде TopAvto в Telegram. Кабинет и ключ доступа выдаются вручную после проверки.
                </p>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="avto-button inline-flex min-h-14 items-center justify-center rounded-2xl px-6 py-4 font-black"
      >
        Запросить доступ
      </button>
      {modal}
    </>
  );
}
