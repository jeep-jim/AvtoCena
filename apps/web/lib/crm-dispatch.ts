const WORKFLOW_URL = "https://api.github.com/repos/jeep-jim/AvtoCena/actions/workflows/crm-telegram-delivery.yml/dispatches";

/** Called only after durable lead creation. No customer data leaves the CRM. */
export async function requestCrmDelivery(
  token = process.env.CRM_GITHUB_DISPATCH_TOKEN || "",
  send: typeof fetch = fetch,
): Promise<"accepted" | "not_configured" | "pending"> {
  if (!token.trim()) return "not_configured";
  try {
    const response = await send(WORKFLOW_URL, {
      method: "POST", redirect: "error",
      headers: {Accept: "application/vnd.github+json", Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"},
      body: JSON.stringify({ref: "main", inputs: {operation: "notify"}}),
      signal: AbortSignal.timeout(2000),
    });
    if (response.status === 204 || response.status === 200) return "accepted";
    console.error("crm_dispatch_pending", response.status);
  } catch {
    console.error("crm_dispatch_pending");
  }
  return "pending";
}
