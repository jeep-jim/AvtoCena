import {LegalDocument} from '@/components/legal/LegalDocument';
import {LEAD_CONSENT_TEXT,LEAD_CONSENT_VERSION} from '@/lib/privacy-documents';
export const metadata={title:'Согласие на обработку заявки — АвтоЦена',alternates:{canonical:'https://avtocena.com/consent'}};
export default function Page(){return <LegalDocument title="Согласие на обработку персональных данных при отправке заявки"><p>{LEAD_CONSENT_TEXT}</p><p>Согласие предоставляется установкой отдельной, изначально пустой галочки и отправкой формы. Без этого действия заявка не отправляется. Аналитика разрешается отдельно через настройки cookie. Отказ от неё не препятствует отправке заявки.</p><p>Идентификатор редакции: {LEAD_CONSENT_VERSION}.</p></LegalDocument>;}
