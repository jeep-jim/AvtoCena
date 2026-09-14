import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ok:false,error:"Вход сотрудников — по персональному ключу на /login"},{status:410}); }
export const POST = GET;
