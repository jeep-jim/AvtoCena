import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { CrmShellView } from "./CrmShellView";
import { defaultManagerAvatar } from "@/lib/default-avatars";

type CrmShellProps = {
  title: string;
  subtitle: string;
  activeHref: string;
  children: React.ReactNode;
};

export async function CrmShell({ title, subtitle, activeHref, children }: CrmShellProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const links: Array<readonly [string, string]> = [
    ["/crm", "Обзор"],
    ["/crm/leads", "Заявки"],
    ["/crm/clients", "Клиенты"],
    ["/crm/managers", "Команда и права"],
    ["/crm/settings", "Рынки и расчёт"],
    ["/crm/dealers", "Дилеры"],
  ];
  if (!isAdminRole(user.role)) links.splice(3);
  if (isAdminRole(user?.role)) links.push(["/crm/telegram", "Telegram"]);
  const avatar = user?.avatarUrl || defaultManagerAvatar(user?.id || user?.telegramUsername);

  return <CrmShellView title={title} subtitle={subtitle} activeHref={activeHref} user={user} links={links} avatar={avatar}>{children}</CrmShellView>;
}
