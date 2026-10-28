"use client";
import {groupFilterModels} from "@/lib/catalog/model-filter-options";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {createModelSuggestionSearch, mergeModelSuggestions, typedModelSelection, typedModelMake} from "@/lib/catalog/model-suggestion-search";
import {canonicalCatalogBrand} from "@/lib/catalog/brands";
import {loadModelSuggestions} from "@/lib/catalog/model-suggestion-loader";

type ModelSuggestion = {
  id?: string;
  make: string;
  model: string;
  aliases?: string[];
  label?: string;
  related?: boolean;
};

type ModelSelection = { make: string; model: string };
let catalogFilterDependentUiMounted = false;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
}

function ensureCatalogFilterLayoutPolish() {
  const styleId = "ac-catalog-filter-layout-dependent-polish";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @media(min-width:1024px){
        .ac-catalog-filter-panel input.ac-filter-control[name="model"]{height:52px!important;min-height:52px!important;border-radius:15px!important}
        .ac-catalog-filter-panel .ac-primary-lower-grid{grid-template-columns:minmax(0,1fr) minmax(0,.7fr) minmax(260px,1fr) minmax(130px,.55fr)!important;gap:10px!important}
      }
      @media(max-width:1023px){
        .ac-mobile-filter-sheet input.ac-filter-control[name="model"]{height:46px!important;min-height:46px!important;border-radius:13px!important}
        .ac-mobile-filter-sheet .ac-mobile-secondary-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}
        .ac-mobile-filter-sheet .ac-mobile-secondary-grid .ac-filter-control{min-width:0!important;padding-left:11px!important;padding-right:11px!important;font-size:12px!important}
        .ac-mobile-filter-sheet .ac-mobile-secondary-grid>.ac-mobile-secondary-span{grid-column:1/-1!important}
        .ac-mobile-filter-sheet .ac-mobile-eyebrow-hidden{display:none!important}
        .ac-mobile-filter-sheet.ac-mobile-filter-sheet.ac-mobile-filter-sheet .ac-filter-clear--mobile{margin-left:auto!important;margin-right:24px!important}
        .ac-filter-more-button>.ac-filter-tray-main{display:inline-flex!important;align-items:center!important;gap:8px!important;min-width:0!important}
        .ac-filter-more-button>.ac-filter-tray-main>svg{width:20px!important;height:20px!important;flex:0 0 20px!important}
        .ac-filter-more-button>.ac-filter-tray-clear{order:5!important;margin-left:auto!important;margin-right:0!important}
      }
    `;
    document.head.appendChild(style);
  }

  const desktop = document.querySelector<HTMLElement>(".ac-catalog-filter-panel");
  if (desktop) {
    Array.from(desktop.children).forEach((child) => {
      const row = child as HTMLElement;
      if (row.querySelector(".ac-power-limit") && row.querySelector(".ac-electric-filter") && row.querySelector(".ac-sort-control")) row.classList.add("ac-primary-lower-grid");
    });
  }

  const sheet = document.querySelector<HTMLElement>(".ac-mobile-filter-sheet");
  if (sheet) {
    const header = sheet.querySelector<HTMLElement>(":scope > div:first-child > div:nth-child(2)");
    header?.querySelectorAll<HTMLElement>("div").forEach((element) => {
      if (!element.children.length && clean(element.textContent).toLocaleLowerCase("ru-RU") === "каталог") element.classList.add("ac-mobile-eyebrow-hidden");
    });


    const advanced = sheet.querySelector<HTMLElement>(".ac-advanced-fields");
    advanced?.querySelectorAll<HTMLElement>(":scope > div").forEach((grid) => {
      const secondaryNames = Array.from(grid.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')).map((input) => input.name);
      if (!secondaryNames.some((name) => ["bodyType", "transmission", "fuel", "drive"].includes(name))) return;
      grid.classList.add("ac-mobile-secondary-grid");
      const visibleChildren = Array.from(grid.children).filter((child) => !(child as HTMLElement).classList.contains("ac-mobile-market-field"));
      visibleChildren.forEach((child) => (child as HTMLElement).classList.remove("ac-mobile-secondary-span"));
      if (visibleChildren.length % 2 === 1) (visibleChildren.at(-1) as HTMLElement | undefined)?.classList.add("ac-mobile-secondary-span");
    });
  }

  const tray = document.querySelector<HTMLElement>(".ac-filter-more-button");
  if (tray) {
    const main = tray.querySelector<HTMLElement>(":scope > span:first-child");
    if (main) {
      main.classList.add("ac-filter-tray-main");
      const icon = tray.querySelector<SVGElement>(":scope > svg");
      if (icon && !main.contains(icon)) main.prepend(icon);
    }
    const clear = tray.querySelector<HTMLElement>(":scope > .ac-filter-tray-clear");
    if (clear && clear !== tray.lastElementChild) tray.appendChild(clear);
  }
}

function useCatalogFilterDependentUi(enabled = true) {
  useEffect(() => {
    if (!enabled || catalogFilterDependentUiMounted) return;
    catalogFilterDependentUiMounted = true;
    let frame = 0;
    const refresh = () => {
      frame = 0;
      ensureCatalogFilterLayoutPolish();
    };
    const requestRefresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(refresh);
    };
    let delay = 0;
    const delayedRefresh = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".ac-catalog-filter-panel, .ac-mobile-filter-sheet")) return;
      window.clearTimeout(delay);
      delay = window.setTimeout(requestRefresh, 260);
    };

    refresh();
    const observer = new MutationObserver((records) => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return Boolean(target?.closest(".ac-catalog-filter-panel, .ac-mobile-filter-sheet")) || Array.from(record.addedNodes).some(node => node instanceof Element && (node.matches(".ac-catalog-filter-panel, .ac-mobile-filter-sheet") || node.querySelector(".ac-catalog-filter-panel, .ac-mobile-filter-sheet")));
      })) requestRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", delayedRefresh, true);
    document.addEventListener("change", delayedRefresh, true);
    document.addEventListener("click", delayedRefresh, true);
    window.addEventListener("popstate", requestRefresh);
    window.addEventListener("resize", requestRefresh);

    return () => {
      catalogFilterDependentUiMounted = false;
      window.clearTimeout(delay);
      observer.disconnect();
      document.removeEventListener("input", delayedRefresh, true);
      document.removeEventListener("change", delayedRefresh, true);
      document.removeEventListener("click", delayedRefresh, true);
      window.removeEventListener("popstate", requestRefresh);
      window.removeEventListener("resize", requestRefresh);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
}

export function VehicleModelSearch({
  value,
  make,
  placeholder = "Любая модель",
  onMakeChange,
  onValueChange,
  onSubmit,
  className = "",
  inputClassName = "ac-filter-control h-13 w-full rounded-[15px] px-4 text-sm font-black outline-none",
  contextual = true,
  required = false,
  multiple = false,
  contextQuery,
  sourceItems,
}: {
  value: string;
  make: string;
  placeholder?: string;
  onMakeChange?: (make: string) => void;
  onValueChange?: (model: string) => void;
  onSubmit?: (selection: ModelSelection) => void;
  className?: string;
  inputClassName?: string;
  contextual?: boolean;
  required?: boolean;
  multiple?: boolean;
  contextQuery?: string;
  sourceItems?:ModelSuggestion[];
}) {
  const [query, setQuery] = useState(multiple ? value.split("|").filter(Boolean).join(", ") : value || "");
  const [remoteItems, setItems] = useState<ModelSuggestion[]>([]);
  const [directory,setDirectory]=useState<ReturnType<typeof createModelSuggestionSearch>|null>(null);
  const [inventory,setInventory]=useState<ReturnType<typeof createModelSuggestionSearch>|null>(null);
  const [supplierLoading,setSupplierLoading]=useState(0);
  const [supplierError,setSupplierError]=useState(false);
  const [supplierSearches,setSupplierSearches]=useState<Array<ReturnType<typeof createModelSuggestionSearch>>>([]);
  const [visibleCount,setVisibleCount]=useState(60);
  const [inventoryError,setInventoryError]=useState(false);
  const [inventoryLoading,setInventoryLoading]=useState(false);
  const [directoryError,setDirectoryError]=useState(false),[retry,setRetry]=useState(0);
  const searchQuery = multiple ? query.split(",").at(-1)?.trim() || "" : query;
  const sourceStock=new URLSearchParams(contextQuery||'').get('stock')||'';
  const sourceOnly=Boolean(sourceItems)&&sourceStock==='green';
  const sourceSearch=useMemo(()=>sourceItems?createModelSuggestionSearch({version:1,brands:[],models:sourceItems.map(item=>[item.make,item.model,item.aliases||[],1])}):null,[sourceItems]);
  const items=useMemo(()=>{
    const local=sourceSearch?mergeModelSuggestions(inventory?.(searchQuery,make)||[],mergeModelSuggestions(sourceSearch(searchQuery,make),sourceOnly?[]:directory?.(searchQuery,make)||[],searchQuery),searchQuery):contextual?mergeModelSuggestions(inventory?.(searchQuery,make)||[],directory?.(searchQuery,make)||[],searchQuery):remoteItems.map(item=>({...item,aliases:item.aliases||[]}));
    const merged=mergeModelSuggestions(supplierSearches.flatMap(search=>search(searchQuery,make)),local,searchQuery);
    return contextual?groupFilterModels(merged):merged;
  },[sourceSearch,sourceOnly,contextual,inventory,directory,searchQuery,make,remoteItems,supplierSearches]);
  useEffect(()=>setVisibleCount(60),[searchQuery,make]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialogInput=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDivElement>(null);
  const [mobile,setMobile]=useState(false);
  const [viewport,setViewport]=useState<{top:number;height:number}|null>(null);
  const closeRef=useRef(()=>{});
  useEffect(()=>{const media=window.matchMedia('(max-width:1023px)');const sync=()=>setMobile(media.matches&&contextual&&multiple);sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[contextual,multiple]);
  useEffect(()=>{
    if(!open||!mobile)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    const update=()=>{const v=window.visualViewport;setViewport({top:v?.offsetTop||0,height:v?.height||window.innerHeight});};
    const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeRef.current();}if(event.key==='Tab'){const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input');const first=controls?.[0],last=controls?.[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    update();window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);window.addEventListener('resize',update);window.addEventListener('keydown',keydown,true);
    return()=>{document.body.style.overflow=previous;window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);window.removeEventListener('resize',update);window.removeEventListener('keydown',keydown,true);};
  },[open,mobile]);
  const submitRef = useRef(onSubmit);

  useCatalogFilterDependentUi(contextual);
  useLayoutEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { if (!multiple) setQuery(value || ""); }, [value, multiple]);
  useEffect(() => {
    if (multiple && document.activeElement !== input.current && document.activeElement !== dialogInput.current && !(mobile&&open)) setQuery(value.split("|").filter(Boolean).join(", "));
  }, [value, multiple, mobile, open]);
  const selectedModels = value.split("|").map(clean).filter(Boolean);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !dialog.current?.contains(event.target as Node)) { if(mobile)closeRef.current();else setOpen(false); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape"&&!mobile) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open,mobile]);

  const sourceMarket=new URLSearchParams(contextQuery||'').get('market')||'';
  useEffect(()=>{
    setSupplierSearches([]);setSupplierError(false);setSupplierLoading(0);
    if(!contextual||!open||sourceStock==='green')return;
    const markets=sourceMarket?(['korea','japan'].includes(sourceMarket)?[sourceMarket]:sourceItems&&sourceMarket==='china'?['china']:[]):make?['korea','japan']:[];
    let cancelled=false;setSupplierLoading(markets.length);
    // Each directory can extend the picker immediately, independently of peers.
    for(const market of markets)loadModelSuggestions(true,{market,make}).then(search=>{
      if(!cancelled)setSupplierSearches(current=>[...current,search]);
    }).catch(()=>{if(!cancelled)setSupplierError(true);}).finally(()=>{if(!cancelled)setSupplierLoading(count=>Math.max(0,count-1));});
    return()=>{cancelled=true;};
  },[Boolean(sourceItems),contextual,sourceMarket,sourceStock,make,open,retry]);

  useEffect(()=>{
    if(sourceOnly||!contextual||!open||directory)return;
    let cancelled=false;setLoading(true);setDirectoryError(false);
    loadModelSuggestions().then(search=>{if(!cancelled){setLoading(false);setDirectory(()=>search);}}).catch(()=>{if(!cancelled)setDirectoryError(true);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[sourceOnly,contextual,open,directory,retry]);

  useEffect(()=>{
    if(sourceItems||!contextual||!open)return;
    let cancelled=false;setInventoryLoading(true);setInventoryError(false);
    setInventory(null);
    loadModelSuggestions(true,undefined,make,sourceMarket).then(search=>{if(!cancelled){setInventoryLoading(false);setInventory(()=>search);}})
      .catch(()=>{if(!cancelled)setInventoryError(true);})
      .finally(()=>{if(!cancelled)setInventoryLoading(false);});
    return()=>{cancelled=true;};
  },[sourceItems,contextual,open,retry,make,sourceMarket]);
  const searching = loading || (contextual && (inventoryLoading || supplierLoading>0));
  const suggestionError = directoryError || inventoryError || supplierError;

  const multipleMakes = String(make || "").split(",").map(clean).filter(Boolean).length > 1;
  const canSearch = Boolean(!clean(searchQuery) || clean(make) || compact(searchQuery).length >= 2);
  useEffect(() => {
    if(sourceItems||contextual)return;
    if (!open || !canSearch) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: clean(searchQuery), make: clean(make), limit: "50" });
        if (!contextual) params.set("scope", "autocalc");
        const response = await fetch(`/api/catalog/models?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = response.ok ? await response.json() : { items: [] };
        if (!controller.signal.aborted) setItems(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sourceItems, canSearch, make, open, searchQuery, contextual]);

  const exact = useMemo(() => {
    const requested = compact(searchQuery);
    return items.find((item) => compact(item.model) === requested || (item.aliases || []).some((alias) => compact(alias) === requested));
  }, [items, searchQuery]);

  const applySelection = (item: ModelSuggestion) => {
    if (multiple) {
      const next = selectedModels.includes(item.model) ? selectedModels.filter(model => model !== item.model) : [...selectedModels, item.model];
      onValueChange?.(next.join("|"));
      if (!make) onMakeChange?.(item.make);
      setQuery(mobile ? "" : next.length ? `${next.join(", ")}, ` : "");
      setOpen(true);
      (mobile?dialogInput:input).current?.focus({preventScroll:true});
      return root.current?.closest("form") || null;
    }
    setQuery(item.model);
    setOpen(false);
    onValueChange?.(item.model);
    onMakeChange?.(item.make);
    const form = root.current?.closest("form");
    const modelInput = input.current;
    const makeInput = form?.querySelector<HTMLInputElement>('input[name="make"]');
    if (modelInput) modelInput.value = item.model;
    if (makeInput) makeInput.value = item.make;
    return form;
  };

  const choose = (item: ModelSuggestion, submit = false) => {
    if (!submit) {
      applySelection(item);
      return;
    }

    let form: HTMLFormElement | null = null;
    flushSync(() => { form = applySelection(item); });
    const selection = { make: item.make, model: item.model };
    window.requestAnimationFrame(() => {
      if (submitRef.current) submitRef.current(selection);
      else form?.requestSubmit();
    });
  };

  const applyTypedModel = () => {
    const typed=typedModelSelection(query, items, multiple);
    const next=mobile&&multiple?[...new Set([...selectedModels,...typed.split("|").filter(Boolean)])].join("|"):typed;
    if(!make){const inferred=typedModelMake(next,items);if(inferred)onMakeChange?.(inferred);}
    onValueChange?.(next);
    setQuery(multiple ? next.split("|").join(", ") : next);
    setOpen(false);
    input.current?.blur();dialogInput.current?.blur();
  };
  closeRef.current=applyTypedModel;

  const options=<>


      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-2">
        <span className="text-sm font-bold">Модель автомобиля</span>
        <button type="button" aria-label="Закрыть список моделей" className="min-h-11 rounded-xl px-3 text-sm font-bold" onPointerDown={event=>event.preventDefault()} onClick={applyTypedModel}>Готово ×</button>
      </div>
      {mobile&&<input ref={dialogInput} autoFocus type="search" aria-label="Поиск модели" value={query} autoComplete="off" spellCheck={false} enterKeyHint="done" placeholder="Начните вводить модель" className="my-2 h-12 w-full shrink-0 rounded-xl bg-[var(--ac-surface-2)] px-3 text-base font-bold outline-none" onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();applyTypedModel();}}}/>}
      {mobile&&multiple&&selectedModels.length>0&&<div className="ac-hide-scrollbar flex shrink-0 gap-2 overflow-x-auto pb-2"><button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>{onValueChange?.("");setQuery("");}} className="shrink-0 rounded-full px-3 py-2 text-xs font-bold">Очистить</button>{selectedModels.map(model=><button key={model} type="button" aria-label={`Убрать модель ${model}`} onPointerDown={event=>event.preventDefault()} onClick={()=>onValueChange?.(selectedModels.filter(value=>value!==model).join("|"))} className="shrink-0 rounded-full bg-[var(--ac-surface-2)] px-3 py-2 text-xs font-bold">{model} ×</button>)}</div>}
      {multiple && !mobile && <><p className="px-3 py-2 text-xs text-[var(--ac-muted)]">Выберите модели или введите название и нажмите «Применить»</p><button type="button" className="ac-filter-option min-h-11 w-full rounded-xl text-sm font-bold" onClick={() => { onValueChange?.(""); setQuery(""); }}>Любая модель</button></>}
      <div className={`ac-hide-scrollbar min-h-0 overflow-y-auto overscroll-contain ${mobile?"flex-1":"max-h-[min(18rem,35dvh)]"}`}>
        {!canSearch ? <div className="px-3 py-4 text-sm font-bold text-[var(--ac-muted)]">Введите минимум 2 символа модели</div> : null}
        {canSearch && searching && !items.length ? <div className="px-3 py-4 text-sm font-bold text-[var(--ac-muted)]">Ищем модель…</div> : null}
        {canSearch && items.length ? items.slice(0,visibleCount).map((item) => <button
          key={item.id || `${item.make}:${item.model}`}
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => choose(item)}
          aria-pressed={multiple ? selectedModels.includes(item.model) : undefined}
          className="ac-filter-option flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold"
        >
          <span className="min-w-0"><span className="block truncate">{item.model}</span>{item.related&&<span className="block text-[11px] font-semibold opacity-70">Похожая модель</span>}{!make || multipleMakes ? <span className="block truncate text-[11px] font-semibold opacity-55">{canonicalCatalogBrand(item.make)}</span> : null}</span>
          {multiple ? <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm" style={{ background: selectedModels.includes(item.model) ? "#ff353d" : "var(--ac-surface-3)", border: selectedModels.includes(item.model) ? "1px solid #ff353d" : "1px solid rgba(103,113,130,.55)", color: selectedModels.includes(item.model) ? "#fff" : "transparent" }}>✓</span> : <span className="shrink-0 opacity-70">↵</span>}
        </button>) : null}
        {items.length>visibleCount?<button type="button" className="min-h-11 w-full px-3 py-3 text-sm font-bold" onPointerDown={event=>event.preventDefault()} onClick={()=>setVisibleCount(count=>count+60)}>Показать ещё · {items.length-visibleCount}</button>:null}
        {contextual&&suggestionError?<button type="button" className="px-3 py-4 text-sm font-bold" onClick={()=>setRetry(value=>value+1)}>Не удалось загрузить все модели. Повторить</button>:null}
        {canSearch && !searching && !suggestionError && !items.length ? <div className="px-3 py-4 text-sm font-bold text-[var(--ac-muted)]">Модель не найдена. Попробуйте часть названия</div> : null}
      </div>
      <button type="button" onPointerDown={event=>event.preventDefault()} onClick={applyTypedModel} className="mt-2 min-h-11 shrink-0 w-full rounded-xl bg-red-500 px-4 text-sm font-bold text-white">Применить</button>
  </>;

  return <div ref={root} className={`relative min-w-0 ${open ? "z-[235]" : "z-0"} ${className}`}>
    {multiple && <input type="hidden" name="model" value={value} />}
    <input
      ref={input}
      type="search"
      name={multiple ? undefined : "model"}
      value={query}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      readOnly={mobile}
      onClick={()=>{if(mobile){if(multiple)setQuery("");setOpen(true);}}}
      onFocus={() => {if(mobile&&multiple)setQuery("");setOpen(true);}}
      onBlur={(event) => {
        if (!mobile && multiple && !root.current?.contains(event.relatedTarget as Node)) applyTypedModel();
      }}
      onChange={(event) => {
        setQuery(event.target.value);
        if (!multiple) onValueChange?.(event.target.value);
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (multiple) { applyTypedModel(); return; }
        if (exact) choose(exact, true);
        else { setOpen(false); input.current?.blur(); submitRef.current?.({make, model:clean(query)}); }
      }}
      className={inputClassName}
      required={required}
      aria-label="Модель автомобиля"
      aria-expanded={open}
      aria-autocomplete="list"
    />
    {open&&!mobile?<div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">{options}</div>:null}
    {open&&mobile?createPortal(<div data-model-picker className="fixed inset-x-0 z-[25000] flex items-start justify-center bg-black/65 p-2 backdrop-blur-md" style={{top:viewport?.top||0,height:viewport?.height||'100dvh'}} onMouseDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();if(event.target===event.currentTarget)applyTypedModel();}}><div ref={dialog} role="dialog" aria-modal="true" aria-label="Выбор моделей" className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-3xl bg-[var(--ac-surface)] p-3 text-[var(--ac-text)]">{options}</div></div>,document.body):null}
  </div>;
}
