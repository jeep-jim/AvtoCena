import { NextResponse } from "next/server";
import { getAvtocenaCases, getAvtocenaResults, getSearchInputFromParams, parseRub } from "@/lib/avtocena";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("case");

  if (caseId) {
    const item = getAvtocenaCases().find((current) => current.id === caseId);
    return NextResponse.json(item ?? { error: "case_not_found" }, { status: item ? 200 : 404 });
  }

  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const input = getSearchInputFromParams(params);
  return NextResponse.json({ input, results: getAvtocenaResults(input) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const input = {
    budgetRub: typeof body.budgetRub === "number" ? body.budgetRub : parseRub(body.budget),
    brand: body.brand,
    model: body.model,
    yearFrom: typeof body.yearFrom === "number" ? body.yearFrom : parseRub(body.yearFrom),
    market: body.market || "any",
    body: body.body || "any"
  };

  return NextResponse.json({ input, results: getAvtocenaResults(input) });
}
