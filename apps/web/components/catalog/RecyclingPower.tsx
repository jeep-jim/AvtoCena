import type { RecyclingPowerInfo } from "../../lib/catalog/recycling-power";
import styles from "./RecyclingPower.module.css";

export function RecyclingPowerLabel({ hpLabel, info, kw, showKw = false }: {
  hpLabel: string; info: RecyclingPowerInfo | null; showKw?: boolean; kw?: unknown;
}) {
  const value = Number(kw ?? info?.kw);
  const kwLabel = Number.isFinite(value) && value > 0 ? `${value.toLocaleString("ru-RU", {maximumFractionDigits:2})} кВт` : "";
  return <span className={styles.value} data-recycling-power={showKw && kwLabel ? "paired" : undefined}>
    <span className={styles.unit}>{hpLabel}</span>
    {showKw && kwLabel ? <span className={`${styles.unit} ${info?.aboveLimit ? styles.warningText : ""}`}>{hpLabel ? " / " : ""}{kwLabel}</span> : null}
  </span>;
}
export function RecyclingPowerExplanation({ info }: { info: RecyclingPowerInfo | null }) {
  return <div className={styles.explanation}>
    {info ? <p className={info.aboveLimit ? styles.warningText : undefined}>{info.reason}</p> : null}
    <p>Для выбора диапазона утильсбора используется мощность в кВт. Лошадиные силы в объявлении могут быть округлены: 160 л.с. и 118 кВт не означают льготный сбор.</p>
    <p>Порог 117,68 кВт относится к M1 с ДВС. Для льготы также важны объём до 3 000 см³, ввоз физлицом для личного пользования и соблюдение остальных условий. Для N1, электромобилей и гибридов действуют отдельные правила. Характеристики и право на льготу нужно подтвердить по документам.</p>
    <a href="https://www.nalog.gov.ru/rn77/about_fts/about_nalog/16602625/" target="_blank" rel="noopener noreferrer">Разъяснение ФНС о мощности в кВт ↗</a>
  </div>;
}
/** Native disclosure works without hydration and stays inside the existing price breakdown. */
export function RecyclingFeeHelp({ info }: { info: RecyclingPowerInfo | null }) {
  return <details className={styles.feeHelp} data-recycling-fee-help>
    <summary><span className={styles.question} aria-hidden="true">?</span><span>{info?.aboveLimit ? `${info.kwLabel} — выше льготного порога` : "Как определяется утильсбор"}</span></summary>
    <RecyclingPowerExplanation info={info} />
  </details>;
}
