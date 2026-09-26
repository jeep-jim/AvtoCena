import {hasCrmPermission,type CrmPermission} from "@/lib/crm-permissions";
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
  if (["owner", "admin", "manager"].includes(user.role)) links.push(["/crm/documents", "Документы"]);
  const gates:Record<string,CrmPermission>={"/crm/managers":"staff","/crm/settings":"settings","/crm/dealers":"dealers","/crm/telegram":"settings","/crm/documents":"documents","/crm/partners":"settings"};
  const needed=gates[activeHref];
  if(needed&&!hasCrmPermission(user,needed)&&!(activeHref==="/crm/managers"))redirect("/crm");
  const allowedLinks=links.filter(([href])=>!gates[href]||hasCrmPermission(user,gates[href]));
  const avatar = user?.avatarUrl || defaultManagerAvatar(user?.id || user?.telegramUsername);

  return <CrmShellView title={title} subtitle={subtitle} activeHref={activeHref} user={user} links={allowedLinks} avatar={avatar}>{children}</CrmShellView>;
}
