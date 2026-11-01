/** Fixed public messages only; never surface supplier bodies or request URLs. */
export class CatalogPageRequestError extends Error {
  constructor(public readonly kind: 'timeout' | 'unavailable' | 'invalid') {
    super(`catalog_page_${kind}`);
  }
}
export function catalogPageErrorMessage(error: unknown) {
  if (error instanceof CatalogPageRequestError && error.kind === 'timeout')
    return 'Загрузка заняла слишком много времени. Нажмите «Показать ещё», чтобы повторить — уже загруженные автомобили сохранены.';
  return 'Не удалось загрузить следующую подборку. Нажмите «Показать ещё», чтобы повторить — уже загруженные автомобили сохранены.';
}
// Cold pages include source, stored edits and current price calculation. Keep a
// bounded deadline below the 120-second proxy deadline, without aborting valid
// responses at the former 30-second client-only limit.
export const CATALOG_PAGE_REQUEST_TIMEOUT_MS = 90_000;
