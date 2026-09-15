import {leadContact} from "@/lib/lead-contact";
export function LeadContact({lead, interactive = false}: {lead: any; interactive?: boolean}) {
  const contact = leadContact(lead);
  const className = `inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-lg px-2.5 py-1.5 text-xs font-bold ${contact.channel === "telegram" ? "bg-[#229ED9] text-white" : contact.channel === "max" ? "bg-[#7B61FF] text-white" : "bg-[var(--ac-surface)] text-[var(--ac-text)]"}`;
  const content = <><span>{contact.label}</span><span className="break-all">{contact.value || "Контакт не указан"}</span>{contact.detail && <span className="w-full text-[10px] opacity-90">{contact.detail}</span>}</>;
  return interactive && contact.href ? <a className={className} href={contact.href} target={contact.channel === "call" ? undefined : "_blank"} rel="noreferrer">{content}</a> : <span className={className}>{content}</span>;
}
