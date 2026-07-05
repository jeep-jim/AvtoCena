export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: true, event: "cpa_postback_received", received: body });
}
