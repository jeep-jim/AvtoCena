import { redirect } from "next/navigation";

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export default async function ResultsRedirect({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const source = (await searchParams) || {};
  const query = new URLSearchParams();

  for (const [key, raw] of Object.entries(source)) {
    const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const targetKey = key === "country" ? "market"
      : key === "brand" ? "make"
        : key === "body" ? "bodyType"
          : key === "year" ? "yearFrom"
            : key;
    for (const value of values) if (value) query.append(targetKey, value);
  }

  const city = first(source.city);
  if (city) query.delete("city");
  redirect(`/cars${query.size ? `?${query.toString()}` : ""}`);
}
