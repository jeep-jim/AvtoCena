import {LegalDocument} from '@/components/legal/LegalDocument';
import {LEAD_CONSENT_TEXT,LEAD_CONSENT_VERSION} from '@/lib/privacy-documents';
export const metadata={title:'Согласие на обработку заявки — АвтоЦена',alternates:{canonical:'https://avtocena.com/consent'}};
export default function Page(){return <LegalDocument title="Согласие на обработку персональных данных при отправке заявки"><p>{LEAD_CONSENT_TEXT}</p><p>Согласие предоставляется установкой отдельной, изначально пустой галочки и отправкой формы. Без этого действия заявка не отправляется. Одна галочка подтверждает обработку заявки и связь её номера, времени и стадии с посещением сайта для оценки рекламы в описанном выше объёме.</p><p>Идентификатор редакции: {LEAD_CONSENT_VERSION}.</p></LegalDocument>;}
