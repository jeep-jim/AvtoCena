import { NextResponse } from "next/server";
import { errorResponse, uploadClientDocument } from "@/lib/crm-server";
export const dynamic="force-dynamic";
export async function POST(request: Request, { params }: { params: { clientId: string } }) { try { const form = await request.formData(); const result = await uploadClientDocument(params.clientId, form); return NextResponse.json({ ok: true, ...result }); } catch (error) { const { message, status } = errorResponse(error); return NextResponse.json({ ok: false, error: message }, { status }); } }
