import {LegalDocument} from '@/components/legal/LegalDocument';
import {PrivacyRequestForm} from '@/components/legal/PrivacyRequestForm';
export const metadata={title:'Обращение по персональным данным — АвтоЦена',robots:{index:false,follow:true}};
export default function Page(){return <LegalDocument title="Обращение по персональным данным"><p>Здесь можно отозвать согласие, запросить сведения об обработке, уточнить или потребовать удаления данных. Обращение поступит оператору сайта в закрытую CRM.</p><PrivacyRequestForm/></LegalDocument>;}
