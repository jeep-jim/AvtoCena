export const DEALER_MAIL_PROVIDERS = {
 reg: {label: 'Почта REG.RU', url: 'https://webmail.hosting.reg.ru/'},
 yandex: {label: 'Яндекс 360', url: 'https://mail.yandex.ru/'},
} as const;
export type DealerMail = {email: string; provider: '' | keyof typeof DEALER_MAIL_PROVIDERS; ready: boolean};
export function dealerMailLink(mail?: Partial<DealerMail>): string | null {
 if (!mail?.ready || !mail.email || !mail.provider || !Object.hasOwn(DEALER_MAIL_PROVIDERS, mail.provider)) return null;
 return DEALER_MAIL_PROVIDERS[mail.provider].url;
}
export function parseDealerMail(form: FormData): DealerMail | undefined {
 // Older forms must not erase settings they do not contain.
 if (!form.has('mailEmail')) return undefined;
 const email = String(form.get('mailEmail') || '').trim();
 const provider = String(form.get('mailProvider') || '');
 const ready = form.get('mailReady') === 'on';
 if (email && (email.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(email))) throw new Error('Укажите корректный адрес почты');
 if (provider && !Object.hasOwn(DEALER_MAIL_PROVIDERS, provider)) throw new Error('Выберите почтовый сервис');
 if (ready && (!email || !provider)) throw new Error('Для подключения укажите почту и выберите сервис');
 return {email, provider: provider as DealerMail['provider'], ready};
}
