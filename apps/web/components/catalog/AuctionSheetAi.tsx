"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./AuctionSheetAi.module.css";

export function AuctionSheetAi({ imageUrl, title }: { imageUrl: string; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const prompt = `Расшифруй на русском прикреплённый японский аукционный лист. Автомобиль в каталоге: ${title}. Сначала проверь, соответствует ли лист этому автомобилю. Переведи читаемые замечания инспектора, объясни общую оценку, оценки кузова и салона, пробег и отметки на схеме повреждений. Для каждой отметки укажи деталь кузова. Отдельно перечисли сведения о ремонте и замене деталей, только если они есть в листе. Не додумывай неразборчивые символы и отсутствующие сведения: прямо укажи, что не удалось прочитать. Не делай вывод об отсутствии ДТП или неисправностей только по оценке. Если изображение не прикреплено или не читается, попроси загрузить лист лучшего качества.`;

  useEffect(() => () => request.current?.abort(), []);

  async function saveImage() {
    if (busy) return;
    setBusy(true);
    setStatus("");
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (!response.ok) throw Error("download_failed");
      const blob = await response.blob();
      if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type) || !blob.size || blob.size > 20 * 1024 * 1024) throw Error("invalid_image");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `auction-sheet.${blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus("Лист подготовлен к скачиванию. Прикрепите его в чате с Алисой кнопкой «+».");
    } catch {
      if (request.current === controller) setStatus("Не удалось скачать лист. Откройте изображение по ссылке ниже и сохраните его через меню браузера.");
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("Запрос скопирован. Вставьте его в чат вместе с аукционным листом.");
    } catch {
      promptField.current?.focus();
      promptField.current?.select();
      setStatus("Выделите и скопируйте текст запроса вручную.");
    }
  }

  return <>
    <button type="button" className={styles.trigger} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <img src="/brands/alice.svg" alt="" width={24} height={24} />
      <span>Расшифровать с ИИ</span>
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-label="Расшифровать лист с Алисой" data-auction-help onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <header className={styles.header}><h2>Расшифровать лист с Алисой</h2><button type="button" onClick={() => dialog.current?.close()} aria-label="Закрыть расшифровку">×</button></header>
      <div className={styles.body}>
        <p>Сохраните лист и прикрепите его в чате с Алисой. Изображение автоматически не передаётся.</p>
        <button type="button" className={styles.action} disabled={busy} onClick={() => void saveImage()}>{busy ? "Подготавливаем лист…" : "1. Скачать аукционный лист"}</button>
        <a href={imageUrl} target="_blank" rel="noopener noreferrer" className={styles.imageLink}>Открыть изображение отдельно</a>
        <button type="button" className={styles.action} onClick={() => void copyPrompt()}>2. Скопировать запрос</button>
        <details><summary>Текст запроса</summary><textarea ref={promptField} aria-label="Запрос для Алисы" readOnly value={prompt} rows={7} /></details>
        <a className={styles.action} href="https://alice.yandex.ru/" target="_blank" rel="noopener noreferrer">3. Открыть Алису и прикрепить лист</a>
        <p role="status" aria-live="polite">{status}</p>
        <p className={styles.note}>ИИ может ошибаться при чтении рукописных заметок. Перед покупкой подтвердите перевод и состояние автомобиля у специалиста.</p>
      </div>
    </dialog>
  </>;
}
