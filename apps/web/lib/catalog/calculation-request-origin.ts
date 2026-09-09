/** The public origin survives TLS termination even when Request.url uses the container host. */
export function isCalculationOriginAllowed(request: Request): boolean {
 const origin=request.headers.get("origin");
 if(!origin)return true;
 return origin===new URL(request.url).origin || origin==="https://avtocena.com" || origin==="https://www.avtocena.com";
}
