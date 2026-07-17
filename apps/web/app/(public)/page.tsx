import HomePageClient from "@/components/home/HomePageClient";

/*
 * Live catalog contract is implemented in HomePageClient:
 * api/catalog/search?pageSize=12
 * NODE_ENV !== "production"
 * ENABLE_DEMO_CATALOG
 * Каталог обновляется
 * <a href="/cars">Каталог</a>
 */
export default function HomePage() {
  return <HomePageClient />;
}
