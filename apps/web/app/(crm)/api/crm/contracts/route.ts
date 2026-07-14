import { NextResponse } from "next/server";
import { errorResponse, generateContract } from "@/lib/crm-server";
export const dynamic="force-dynamic";
export async function POST(request: Request) { try { const body = await request.json().catch(() => ({})); const result = await generateContract(body); return NextResponse.json({ ok: true, ...result }); } catch (error) { const { message, status } = errorResponse(error); return NextResponse.json({ ok: false, error: message }, { status }); } }
