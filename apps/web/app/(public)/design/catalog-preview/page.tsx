import { notFound } from "next/navigation";
import { CatalogDesignPreview } from "@/components/catalog/CatalogDesignPreview";

export const metadata = { title: "Макет каталога", robots: { index: false, follow: false } };

export default function CatalogPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CatalogDesignPreview />;
}
