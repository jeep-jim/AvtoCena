// Next handles this marker at build time. Plain Node contract tests execute
// server modules directly; replace only the marker, never the server code.
import {registerHooks} from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return {url:new URL('./server-only-empty.cjs', import.meta.url).href,shortCircuit:true};
    return nextResolve(specifier, context);
  },
});
