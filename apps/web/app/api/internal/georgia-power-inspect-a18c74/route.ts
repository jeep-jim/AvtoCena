import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

const TARGETS = [
  ["913967", "https://autopapa.ge/en/usd/kia/Seltos%20/913967", "missing"],
  ["913963", "https://autopapa.ge/en/usd/kia/sorento/913963", "missing"],
  ["913954", "https://autopapa.ge/en/usd/hyundai/sonata/913954", "missing"],
  ["913950", "https://autopapa.ge/en/usd/honda/accord/913950", "missing"],
  ["909902", "https://autopapa.ge/en/usd/mercedes-benz/gle-350/909902", "missing"],
  ["909900", "https://autopapa.ge/en/usd/mazda/cx-5/909900", "missing"],
  ["932906", "https://autopapa.ge/en/usd/chevrolet/captiva/932906", "powered"],
  ["957226", "https://autopapa.ge/en/usd/hyundai/elantra/957226", "powered"],
  ["957222", "https://autopapa.ge/en/usd/subaru/outback/957222", "powered"],
  ["957218", "https://autopapa.ge/en/usd/bmw/x5/957218", "powered"],
] as const;

function plain(value: string) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function windows(text: string, pattern: RegExp, radius = 180, limit = 20) {
  const rows: string[] = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const matcher = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(matcher)) {
    const index = match.index || 0;
    rows.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + match[0].length + radius)));
    if (rows.length >= limit) break;
  }
  return [...new Set(rows)];
}

export async function GET() {
  const results = [];
  for (const [id, url, expected] of TARGETS) {
    try {
      const response = await fetch(url, { headers: HEADERS, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(25_000) });
      const markup = await response.text();
      const text = plain(markup);
      const start = text.search(/\bBody\s+Type\s*:/i);
      const end = start >= 0 ? text.indexOf("Car description", start) : -1;
      const facts = start >= 0 ? text.slice(start, end > start ? end : Math.min(text.length, start + 2_500)) : "";
      const powerField = facts.match(/\bPower\s*:\s*([^:]{0,80}?)(?=\s+[A-Z][A-Za-z ]{1,30}\s*:|$)/i)?.[1]?.trim() || null;
      results.push({
        id,
        expected,
        status: response.status,
        finalUrl: response.url,
        facts,
        powerField,
        factPowerMentions: windows(facts, /\b(?:power|horsepower|hp|kw|kilowatt)\b/ig, 120, 12),
        pagePowerMentions: windows(text, /\b(?:power|horsepower|hp|kw|kilowatt)\b/ig, 140, 20),
        markupKeyMentions: windows(markup.replace(/\s+/g, " "), /(?:power|horsepower|horse_power|engine_power|hp|kw)/ig, 160, 25),
      });
    } catch (error) {
      results.push({ id, expected, error: String((error as Error)?.message || error).slice(0, 300) });
    }
  }
  return NextResponse.json({ mode: "read_only_fixed_autopapa_power_inspection", results }, { headers: { "cache-control": "no-store" } });
}
