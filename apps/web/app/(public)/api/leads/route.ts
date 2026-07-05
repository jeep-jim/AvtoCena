export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: true, leadId: `lead_${Date.now()}`, received: body });
}
