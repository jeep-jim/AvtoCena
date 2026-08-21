import type { VehicleOffer } from "./types";

function explicitLiters(value: unknown) {
  const text = String(value || "").replace(/,/g, ".");
  const patterns = [
    /(?:^|[\s([{,;:/+\-])([0-9](?:\.[0-9])?)\s*(?:L|л|liter|litre)\b/i,
    /(?:^|[\s([{,;:/+\-])([0-9](?:\.[0-9])?)\s*(?:TSI|TFSI|TDI|GDI|MPI|Turbo|T)\b/i,
    /(?:^|[\s([{,;:/+\-])([0-8]\.[0-9])\s*(?:A\/?T|M\/?T|AMT|CVT|DCT|DSG)\b/i,
  ];
  for (const pattern of patterns) {
    const liters = Number(text.match(pattern)?.[1] || 0);
    if (Number.isFinite(liters) && liters >= 0.6 && liters <= 8) return liters;
  }
  return 0;
}

export function enrichOfferWithExplicitEngineDisplacement<T extends VehicleOffer>(input: T): T {
  if (Number(input.engineCc || 0) > 0) return input;
  const liters = explicitLiters([input.model, input.trim, input.engineType, input.generation].filter(Boolean).join(" "));
  if (!liters) return input;
  const engineCc = Math.round(liters * 1_000);
  return {
    ...input,
    engineCc,
    operational: {
      ...input.operational,
      raw: {
        ...(typeof input.operational?.raw === "object" && input.operational.raw ? input.operational.raw as object : {}),
        explicitEngineDisplacement: { liters, engineCc },
      },
    },
  } as T;
}
