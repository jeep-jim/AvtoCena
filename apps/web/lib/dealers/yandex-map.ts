import type { DealerOffice } from './showcase-model';

export function yandexOfficeUrls(office: DealerOffice) {
  const params = new URLSearchParams({ lang: 'ru_RU' });
  const { lat, lon } = office;
  if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    params.set('ll', `${lon},${lat}`);
    params.set('pt', `${lon},${lat},pm2rdm`);
    params.set('z', '16');
  } else {
    params.set('mode', 'search');
    params.set('text', [office.city, office.address].filter(Boolean).join(', '));
  }
  return {
    widget: `https://yandex.ru/map-widget/v1/?${params}`,
    full: `https://yandex.ru/maps/?${params}`,
  };
}
