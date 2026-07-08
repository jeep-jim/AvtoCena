import { NextResponse } from "next/server";
import { appendDataJson, readDataJson } from "@/lib/data";

export async function GET() {
  return NextResponse.json(readDataJson("partners/partners.json", []));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || body.telegram || body.name || Date.now())
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-|-$/g, "");

  const partner = appendDataJson("partners/partners.json", {
    id: `partner_${Date.now()}`,
    createdAt: new Date().toISOString(),
    code,
    name: body.name || "Партнёр",
    telegram: body.telegram || null,
    status: "active",
    payoutRub: 10000,
    link: `https://avtocena.com/?ref=${code}`
  });

  return NextResponse.json({ ok: true, partner });
}
