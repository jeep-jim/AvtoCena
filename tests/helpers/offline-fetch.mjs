// Unit/contract tests must provide their own fetch fixtures. Never turn a
// registry assertion or a health probe into a request to production or sources.
globalThis.fetch = async () => {
  throw new Error('test_live_fetch_blocked: install an explicit fetch fixture');
};
