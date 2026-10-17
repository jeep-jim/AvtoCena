import type {PublicDealerRequisites} from '@/lib/dealers/requisites';
export function DealerRequisites({value}: {value?:PublicDealerRequisites}) {
 if(!value?.legalName)return null;
 return <section className="dealer-requisites" aria-label="Реквизиты дилера"><h3>Исполнитель (дилер)</h3><p>{value.legalName}</p><dl>{([
  ['Юридический адрес',value.legalAddress],['ИНН',value.inn],
  [value.ogrn.length===15?'ОГРНИП':'ОГРН',value.ogrn],['КПП',value.kpp],
 ] as const).filter(([,v])=>v).map(([label,v])=><div key={label}><dt>{label}</dt><dd>{v}</dd></div>)}</dl></section>;
}
