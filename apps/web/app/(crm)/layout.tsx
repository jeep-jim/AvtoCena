import type { Metadata } from "next";
import "../flat-ui.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return children;
}
