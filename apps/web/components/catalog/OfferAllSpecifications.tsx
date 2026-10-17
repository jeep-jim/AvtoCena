import type { SourceSpecificationSnapshot } from "../../lib/catalog/source-specifications";
import { translateKnownSpecification, readableSpecificationLabel } from "../../lib/catalog/specification-vocabulary";
import { SpecificationSectionIcon } from "./SpecificationSectionIcon";
import styles from "./OfferSpecifications.module.css";
const foreign = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Georgian}]/u;
function readableLabel(value:string) {
 return readableSpecificationLabel(value);
}
function valueText(value:string) {
 return translateKnownSpecification(value).replace(/\s*\/\s*(?=(?:спереди|сзади|Передн|Задн|Водител|Пассажир))/gi,"\n").replace(/;\s*/g,";\n");
}
export function OfferAllSpecifications({ snapshot, groups = snapshot?.groups || [], showHeading = true, sourceUrl }: { snapshot?: SourceSpecificationSnapshot; groups?: SourceSpecificationSnapshot["groups"]; showHeading?: boolean; sourceUrl?: string }) {
 if (!groups.length) return <p className="text-sm text-[var(--ac-muted)]">Источник пока не предоставил характеристики.</p>;
 return <section className={styles.root} aria-label="Все характеристики">
  {showHeading ? <h2 className="text-xl font-black">Все характеристики</h2> : null}
  {groups.map((group,index)=>{
   const name=readableLabel(group.name) || "Дополнительные сведения";
   const rows=group.items.map(item=>({...item,label:readableLabel(item.name),displayValue:valueText(item.value)}));
   const known=rows.filter(item=>item.label && !foreign.test(item.displayValue));
   const unresolved=rows.filter(item=>!item.label || foreign.test(item.displayValue));
   return <section key={index} className={styles.section}>
    <h3 className={styles.heading}><SpecificationSectionIcon name={name}/><span>{name}</span><span className={styles.rule} aria-hidden/></h3>
    <dl className={styles.rows}>{known.map((item,i)=><div key={i} className={styles.row}><dt>{item.label}</dt><dd>{item.displayValue.trim() && !/^[—-]$/.test(item.displayValue.trim())?item.displayValue:"Не указано"}</dd></div>)}</dl>
    {unresolved.length ? <details className={styles.unresolved}><summary>Данные требуют уточнения ({unresolved.length})</summary><p>Источник передал неполное название или текст без подтверждённого перевода. Оригинальные сведения:</p><dl className={styles.rows}>{unresolved.map((item,i)=><div key={i} className={styles.row}><dt>{item.label||item.name}</dt><dd>{item.displayValue||"Не указано"}</dd></div>)}</dl></details> : null}
   </section>;
  })}
  {sourceUrl && /^https?:\/\//i.test(sourceUrl) ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#ef3340] underline underline-offset-4">Открыть объявление источника ↗</a> : null}
 </section>;
}
