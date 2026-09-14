import type { AuthUser } from "./auth";
export function canSeeLead(user: AuthUser | null | undefined, lead: any) {
  return Boolean(
    user &&
      user.status !== "disabled" &&
      (["owner", "admin"].includes(user.role) ||
        (user.role === "manager" &&
          (lead.assignedManagerId === user.id ||
            lead.createdByManagerId === user.id))),
  );
}
export const activeLead = (lead: any) => !lead.archivedAt;
export function filterLeads(
  leads: any[],
  user: AuthUser | null,
  params: { view?: string; status?: string; manager?: string; q?: string } = {},
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
