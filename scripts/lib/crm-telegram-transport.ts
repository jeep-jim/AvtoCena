type WebhookInfo = {url?:string;pending_update_count?:number;last_error_message?:string;last_error_date?:number};
export async function recoverTelegramTransport(
  info: WebhookInfo, eventDriven: boolean,
  telegram: (method:string, body?:unknown)=>Promise<any>,
  setEventDrivenMode: (enabled:boolean)=>Promise<void>,
) {
  const known = info.url === "https://bbaohms2ccpm3vb4e73t.containers.yandexcloud.net/api/telegram/incoming";
  if (!known || !(Number(info.pending_update_count)>0) || !/timeout|timed out/i.test(info.last_error_message||"")) return {info,eventDriven,recovered:false};
  // Guard the shared state first; preserve both Telegram updates and the local queue.
  await setEventDrivenMode(false);
  await telegram("deleteWebhook", {drop_pending_updates:false});
  const after = await telegram("getWebhookInfo") as WebhookInfo;
  if (after.url) throw Error("webhook_not_removed");
  return {info:after,eventDriven:false,recovered:true};
}
