import {hasCrmPermission} from "./crm-permissions";
import type { AuthUser } from "./auth";
export function canSeeLead(user: AuthUser | null | undefined, lead: any) {
  return Boolean(
    user && lead &&
      user.status !== "disabled" &&
      (hasCrmPermission(user,"viewAll") ||
        (["owner","admin","manager"].includes(user.role) &&
          (lead.assignedManagerId === user.id ||
            lead.createdByManagerId === user.id))),
  );
}
export const activeLead = (lead: any) => !lead.archivedAt;
export function filterLeads(
  leads: any[],
  user: AuthUser | null,
  params: { view?: string; status?: string; manager?: string; q?: string; date?: string } = {},
) {
  const q = (params.q || "").trim().toLocaleLowerCase("ru");
  return leads
    .filter((lead) => canSeeLead(user, lead))
    .filter((lead) =>
      params.view === "archive" ? Boolean(lead.archivedAt) : activeLead(lead),
    )
    .filter(
      (lead) =>
        params.view !== "my" ||
        lead.assignedManagerId === user?.id ||
        lead.createdByManagerId === user?.id,
    )
    .filter((lead) => !params.date || leadDateKey(lead.createdAt) === params.date)
    .filter((lead) => !params.status || lead.status === params.status)
    .filter(
      (lead) =>
        !params.manager ||
        (params.manager === "unassigned"
          ? !lead.assignedManagerId
          : lead.assignedManagerId === params.manager),
    )
    .filter(
      (lead) =>
        !q ||
        [
          lead.name,
          lead.phone,
          lead.telegram,
          lead.car,
          lead.offerTitle,
          lead.id,
        ]
          .join(" ")
          .toLocaleLowerCase("ru")
          .includes(q),
    );
}

/** Same Novokuznetsk calendar day as the date displayed in CRM. */
export function leadDateKey(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Novokuznetsk", year: "numeric", month: "2-digit", day: "2-digit"}).format(date);
}
