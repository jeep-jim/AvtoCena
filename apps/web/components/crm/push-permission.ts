type NotificationPermissionAPI = Pick<typeof Notification, "permission" | "requestPermission">;

// Call directly from the click handler: no network/worker awaits before the prompt.
export function requestPushPermission(notifications: NotificationPermissionAPI): Promise<NotificationPermission> {
  if (notifications.permission !== "default") return Promise.resolve(notifications.permission);
  return notifications.requestPermission();
}

export function pushPermissionMessage(permission: NotificationPermission): string {
  if (permission === "denied") return "Браузер заблокировал уведомления для сайта. Разрешите их в настройках сайта и нажмите кнопку ещё раз.";
  if (permission === "default") return "Разрешение ещё не выдано. Нажмите кнопку снова и выберите «Разрешить» в запросе браузера.";
  return "";
}
