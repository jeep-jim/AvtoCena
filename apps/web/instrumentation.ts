export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && (process.env.CATALOG_CHINA_LOCAL_GENERATION_DIR || process.env.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 || process.env.CATALOG_CHINA_LOCAL_RUNTIME_SHA)) {
    const {initializeLocalChinaReader} = await import('./lib/catalog/china-local-reader');
    await initializeLocalChinaReader();
  }
}
