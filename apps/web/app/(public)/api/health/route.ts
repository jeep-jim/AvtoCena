export async function GET() {
  return Response.json({
    ok: true,
    service: "avtocena-web",
    releaseSha: process.env.AVTOCENA_RELEASE_SHA || null,
  });
}
