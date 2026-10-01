import {canManageDealer} from "@/lib/dealers/access";
import {isPlatformOwner} from "@/lib/platform-access";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { readShowcase, readPublicFeatures } from "@/lib/dealers/showcase-store";
import { DealerEditor } from "@/components/dealers/DealerEditor";
import { CrmShell } from "@/components/crm/CrmShell";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await canManageDealer(await getCurrentUser(),(await params).id))) notFound();
  const s = await readShowcase((await params).id);
  if (!s) notFound();
  return (
    <CrmShell
      activeHref="/crm/dealers"
      title={`${s.name} — витрина дилера`}
      subtitle="Страница компании, фотографии покупателей и автомобили с быстрой доставкой."
    >
      <Link
        className="mb-5 inline-block text-red-300"
        href={`/crm/dealers/${s.dealerId}`}
      >
        ← Карточка дилера
      </Link>
      <DealerEditor initial={s} features={await readPublicFeatures()} platformOwner={isPlatformOwner(await getCurrentUser())} />
    </CrmShell>
  );
}
