export const dynamic = "force-dynamic";

export function GET() {
  return Response.redirect("https://avtocena.com/feeds/openai-products.csv.gz", 308);
}
