// Zero disables an inventory-count quota; resource limits remain separate.
export function catalogInventoryLimit(value, fallback = 100_000) {
 const limit = value === undefined || value === '' ? fallback : Number(value);
 if (!Number.isSafeInteger(limit) || limit < 0) throw Error('invalid_catalog_inventory_limit');
 return limit === 0 ? Number.MAX_SAFE_INTEGER : limit;
}
