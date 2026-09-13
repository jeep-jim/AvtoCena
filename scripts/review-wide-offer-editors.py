from pathlib import Path

source = Path('apps/web/components/catalog/InlineOfferParameters.tsx')
text = source.read_text()
start = text.index('function Tile(')
end = text.index('export function InlineOfferParameters(', start)
old = text[start:end]
assert 'style={{height:50,zIndex:open?60:undefined}}' in old
assert 'document.addEventListener("click",close)' in old
assert 'data-parameter-editor-grid' not in text
fragment = '''function Tile({label,value,valueNode,warning=false,icon,children,wide=false}:{label:string;value:string;valueNode?:ReactNode;warning?:boolean;icon:ReactNode;children:ReactNode;wide?:boolean}) {
 const ref=useRef<HTMLDetailsElement>(null);
 const id=useId();
 const closeAndFocus=()=>{
  if(ref.current){ref.current.open=false;ref.current.querySelector("summary")?.focus();}
 };
 useEffect(()=>{
  // Click keeps the first outside tap available to the reset button.
  const close=(event:MouseEvent)=>{if(ref.current?.open && !ref.current.contains(event.target as Node))ref.current.open=false;};
  const escape=(event:KeyboardEvent)=>{
   if(event.key==="Escape" && ref.current?.open){event.preventDefault();ref.current.open=false;ref.current.querySelector("summary")?.focus();}
  };
  const blur=(event:FocusEvent)=>{if(ref.current?.open && !ref.current.contains(event.target as Node))ref.current.open=false;};
  document.addEventListener("click",close);document.addEventListener("keydown",escape);document.addEventListener("focusin",blur);
  return ()=>{document.removeEventListener("click",close);document.removeEventListener("keydown",escape);document.removeEventListener("focusin",blur);};
 },[]);
 return <div className={`${editorStyles.tile} min-w-0 ${wide?"col-span-2":""}`}>
  <details ref={ref} data-parameter-editor className={`${editorStyles.editor} ac-attached-editor group rounded-2xl bg-[var(--ac-surface-2)]`}>
   <summary id={`${id}-trigger`} aria-controls={`${id}-panel`} aria-label={`${label}: ${value}`} onClick={event=>{
    event.preventDefault();
    const current=ref.current;
    if(!current)return;
    const next=!current.open;
    if(next){
     current.closest("[data-parameter-editor-grid]")?.querySelectorAll<HTMLDetailsElement>("details[data-parameter-editor][open]").forEach(other=>{if(other!==current)other.open=false;});
    }
    current.open=next;
   }} className={`flex h-12 cursor-pointer list-none items-center gap-3 py-2 pl-4 pr-4 text-left [&::-webkit-details-marker]:hidden ${valueNode ? powerStyles.powerTile : ""} ${warning ? powerStyles.warningTile : ""}`}>
    <span className="shrink-0 text-[var(--ac-muted)]">{icon}</span><span className="min-w-0 flex-1 break-words text-xs font-bold">{valueNode ?? value}</span><ChevronDown aria-hidden size={16} className="ml-2 shrink-0 text-[var(--ac-muted)] transition-transform group-open:rotate-180"/>
   </summary>
   <div id={`${id}-panel`} data-parameter-panel role="region" aria-labelledby={`${id}-trigger`} className={editorStyles.panel}>
    <div className={editorStyles.panelHeader}>
     <span className="text-sm font-bold">{label}</span>
     <button type="button" className={editorStyles.close} aria-label={`Закрыть: ${label}`} onClick={closeAndFocus}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
     </button>
    </div>
    <div className={`${editorStyles.body} ac-attached-editor-body space-y-3 overflow-y-auto p-4`}>{children}</div>
   </div>
  </details>
 </div>;
}
'''
text = text[:start] + fragment + text[end:]
anchor = 'import powerStyles from "./RecyclingPower.module.css";'
assert text.count(anchor) == 1
text = text.replace(anchor, anchor + '\nimport editorStyles from "./InlineParameterPanels.module.css";', 1)
anchor = '<div className="mt-4 grid grid-cols-2 items-start gap-2.5">'
assert text.count(anchor) == 1
text = text.replace(anchor, '<div data-parameter-editor-grid className={`${editorStyles.grid} mt-4 grid grid-cols-2 items-start gap-2.5`}>', 1)
source.write_text(text)
css = source.with_name('InlineParameterPanels.module.css')
assert not css.exists()
css.write_text('''/* Scoped to the offer editor. Catalog cards, counts and prices are unchanged. */
.grid { position: relative; isolation: isolate; z-index: 70; }
.tile { height: 50px; position: static; }
.editor { position: static !important; overflow: visible !important; }
.editor > summary { border-radius: 1rem; }
.editor[open] > summary { box-shadow: inset 0 0 0 1px var(--ac-muted); }
.editor > summary:focus-visible { outline: 2px solid var(--ac-public-accent, #ff4650); outline-offset: 2px; }
.editor:not([open]) > .panel { display: none; }
.panel {
 position: absolute;
 inset-inline: 0;
 top: calc(100% + 8px);
 z-index: 80;
 display: flex;
 flex-direction: column;
 min-width: 0;
 max-height: min(420px, 65dvh);
 overflow: hidden;
 border: 1px solid var(--ac-border);
 border-radius: 1rem;
 background: var(--ac-surface-2);
 color: var(--ac-text);
 box-shadow: 0 12px 28px rgba(0,0,0,.22);
}
.panelHeader { display: flex; flex: none; min-height: 48px; align-items: center; justify-content: space-between; gap: 12px; padding-left: 16px; padding-right: 4px; border-bottom: 1px solid var(--ac-border); }
.close { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; border-radius: 12px; background: transparent; color: var(--ac-muted); cursor: pointer; }
.close:hover, .close:focus-visible { color: var(--ac-text); background: var(--ac-surface); }
.close:focus-visible { outline: 2px solid var(--ac-public-accent, #ff4650); outline-offset: -3px; }
.body { min-height: 0; overflow-x: hidden; overscroll-behavior: contain; overflow-wrap: anywhere; -webkit-overflow-scrolling: touch; }
''')
print('Applied only Tile, editor-grid marker/import and scoped CSS. Calculation implementation unchanged.')
