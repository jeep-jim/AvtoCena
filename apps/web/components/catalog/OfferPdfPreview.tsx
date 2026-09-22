"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { Download, Minus, Plus, X } from "lucide-react";

type Layers = Awaited<ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>>;
type LinkAnnotation = { url: string; rect: number[] };

function PdfPage({ pdf, number, width, layers, revision }: { pdf: PDFDocumentProxy; number: number; width: number; layers: Layers; revision: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [links, setLinks] = useState<Array<LinkAnnotation & { box: number[] }>>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [height, setHeight] = useState(width * 1.415);
  useEffect(() => {
    let disposed = false;
    let rendered = false;
    let task: ReturnType<PDFPageProxy["render"]> | undefined;
    const node = canvas.current;
    if (!node) return;
    node.dataset.rendered = "false";
    setError("");
    void (async () => {
      try {
        const page = await pdf.getPage(number);
        if (disposed) return;
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        setHeight(viewport.height);
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
        node.width = Math.ceil(viewport.width * ratio);
        node.height = Math.ceil(viewport.height * ratio);
        task = page.render({ canvas: node, viewport, transform: [ratio, 0, 0, ratio, 0, 0], optionalContentConfigPromise: Promise.resolve(layers) });
        await task.promise;
        rendered = true;
        if (disposed) return;
        node.dataset.rendered = "true";
        node.dataset.revision = String(revision);
        node.dataset.pageWidth = String(width);
        const annotations = await page.getAnnotations();
        if (disposed) return;
        setLinks(annotations.filter((item: LinkAnnotation) => item.url && /^(https?:|mailto:|tel:)/i.test(item.url)).map((item: LinkAnnotation) => ({ ...item, box: [...viewport.convertToViewportPoint(item.rect[0], item.rect[1]), ...viewport.convertToViewportPoint(item.rect[2], item.rect[3])] })));
        const content = await page.getTextContent();
        if (!disposed) setText(content.items.map(item => "str" in item ? item.str : "").join(" "));
      } catch (e) {
        if (!disposed && !(e instanceof Error && e.name === "RenderingCancelledException")) setError("Не удалось показать страницу. Закройте предпросмотр и попробуйте ещё раз.");
      }
    })();
    return () => { disposed = true; if (!rendered) task?.cancel(); };
  }, [pdf, number, width, layers, revision]);
  return <div className="relative shrink-0 bg-white shadow-lg" style={{ width, height }} data-pdf-page={number}>
    <canvas ref={canvas} style={{ width, height }} aria-label={`Страница ${number}`} />
    <p className="sr-only">{text}</p>
    {links.map((link, index) => <a key={index} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.url} className="absolute rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500" style={{ left: Math.min(link.box[0], link.box[2]), top: Math.min(link.box[1], link.box[3]), width: Math.abs(link.box[2] - link.box[0]), height: Math.abs(link.box[3] - link.box[1]) }} />)}
    {error ? <p role="alert" className="absolute inset-x-3 top-3 bg-white p-3 text-sm text-red-600">{error}</p> : null}
  </div>;
}

export default function OfferPdfPreview({ blob, filename, onClose }: { blob: Blob; filename: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [layers, setLayers] = useState<Layers | null>(null);
  const [revision, setRevision] = useState(0);
  const [width, setWidth] = useState(300);
  const [zoom, setZoom] = useState(1);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = viewport.current;
    const resize = () => { if (node) setWidth(Math.max(240, Math.min(900, node.clientWidth - 24))); };
    resize();
    const observer = new ResizeObserver(resize);
    if (node) observer.observe(node);
    return () => { observer.disconnect(); document.body.style.overflow = previous; previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let loading: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    void (async () => {
      try {
        const engine = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (disposed) return;
        const assets = `/pdfjs/${engine.version}/`;
        engine.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
        loading = engine.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, disableFontFace: true, isOffscreenCanvasSupported: false });
        const document = await loading.promise;
        const config = await document.getOptionalContentConfig();
        if (!disposed) { setPdf(document); setLayers(config); }
      } catch {
        if (!disposed) setError("Не удалось открыть предпросмотр. Попробуйте ещё раз.");
      }
    })();
    return () => { disposed = true; void loading?.destroy(); URL.revokeObjectURL(objectUrl); };
  }, [blob]);
  const groups = layers ? Array.from(layers) : [];
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-label="Предпросмотр PDF" className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-[var(--ac-surface,#e8ebef)] p-0 text-[var(--ac-text,#171c24)] backdrop:bg-black/70">
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--ac-border)] bg-[var(--ac-surface,#fff)] p-3">
        <strong className="mr-auto text-sm">Предпросмотр PDF</strong>
        <a href={url || undefined} download={filename} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#F59E0B] px-3 text-sm font-bold text-[#171C24]"><Download size={18}/>Скачать</a>
        <button type="button" onClick={onClose} aria-label="Закрыть предпросмотр" className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)]"><X size={22}/></button>
        <div className="flex w-full flex-wrap items-center gap-2">
          <button type="button" aria-label="Уменьшить PDF" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] disabled:opacity-40"><Minus size={18}/></button>
          <button type="button" onClick={() => setZoom(1)} className="min-h-11 px-2 text-sm">{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="Увеличить PDF" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.5))} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ac-surface-2)] disabled:opacity-40"><Plus size={18}/></button>
          {groups.length ? <details className="relative ml-auto text-sm"><summary className="cursor-pointer p-3">Разделы</summary><div className="absolute right-0 top-full z-10 w-64 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface,#fff)] p-3 shadow-xl">{groups.map(([id, group]) => <label key={id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={group.visible} onChange={event => { layers?.setVisibility(id, event.target.checked); setRevision(value => value + 1); }}/>{group.name}</label>)}</div></details> : null}
        </div>
      </div>
      <div ref={viewport} className="min-h-0 flex-1 overflow-auto overscroll-contain" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
        {error ? <p role="alert" className="p-6 text-red-500">{error}</p> : !pdf || !layers ? <p role="status" className="p-6">Открываем документ…</p> : <div className="mx-auto flex flex-col gap-4 p-3" style={{ width: width * zoom + 24 }}>{Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index} pdf={pdf} number={index + 1} width={width * zoom} layers={layers} revision={revision}/>)}</div>}
      </div>
    </div>
  </dialog>;
}
