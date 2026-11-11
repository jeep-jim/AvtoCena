// Keep old cached avatar URLs usable without redirecting to an internal server host.
export function GET(){return new Response(null,{status:307,headers:{Location:'/key-logo.png','Cache-Control':'no-store'}});}
