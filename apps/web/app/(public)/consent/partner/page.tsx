import {LegalDocument} from '@/components/legal/LegalDocument';
import {PARTNER_CONSENT_TEXT,PARTNER_CONSENT_VERSION} from '@/lib/privacy-documents';
export const metadata={title:'Согласие на заявку о сотрудничестве — АвтоЦена'};
export default function Page(){return <LegalDocument title="Согласие на обработку заявки о сотрудничестве"><p>{PARTNER_CONSENT_TEXT}</p><p>Согласие предоставляется отдельной изначально пустой галочкой и отправкой заявки. Редакция: {PARTNER_CONSENT_VERSION}.</p></LegalDocument>;}
