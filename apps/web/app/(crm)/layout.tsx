import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, isCrmRole } from "@/lib/auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active" || !isCrmRole(user.role)) redirect("/login");
  return children;
}
