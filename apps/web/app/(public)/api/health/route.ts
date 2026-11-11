export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return Response.json({
    ok: true,
    service: "avtocena-web",
    catalogProjectionParts: "scoped-v1",
    releaseSha: process.env.AVTOCENA_RELEASE_SHA || null,
    calculationVersion: process.env.AVTOCENA_CALCULATION_VERSION || null,
  });
}
