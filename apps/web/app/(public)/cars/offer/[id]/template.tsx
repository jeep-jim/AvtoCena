import type { ReactNode } from "react";
import { OfferFinanceCards } from "@/components/catalog/OfferFinanceCards";

export default function OfferTemplate({ children }: { children: ReactNode }) {
  return <>
    {children}
    <OfferFinanceCards />
  </>;
}
