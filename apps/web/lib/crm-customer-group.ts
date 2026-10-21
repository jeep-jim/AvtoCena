import { normalizeRuPhone } from "./ru-phone";
import { leadDealerId } from "./dealers/lead-routing";

// Apply visibility filters before grouping. Matching a contact never grants access.
export function crmCustomerKey(record: any, client?: any): string {
  const account = record.customerAccountId || record.portalAccountId || client?.portalAccountId;
  const phone = normalizeRuPhone(record.phone || client?.phone || "");
  const identity = account ? `account:${account}` : phone ? `phone:${phone}` : `record:${record.clientId || record.id}`;
  return `${leadDealerId(record)}:${identity}`;
}

export function groupCrmLeads<T extends {clientId?: string}>(leads: T[], clients: any[]) {
  const byId = new Map(clients.map(client => [client.id, client]));
  const groups = new Map<string, T[]>();
  for (const lead of leads) {
    const key = crmCustomerKey(lead, byId.get(lead.clientId));
    const group = groups.get(key) || [];
    group.push(lead);
    groups.set(key, group);
  }
  return [...groups.values()];
}
