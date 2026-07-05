export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: true, partnerId: `partner_${Date.now()}`, received: body });
}
