/** Persistent notifications also work on Android, where new Notification throws. */
export async function showBrowserNotification(
  title: string,
  options: NotificationOptions,
  href: string,
): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    throw new Error("Notifications are not permitted");
  }
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/notifications-sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, { ...options, data: { href } });
    return;
  }
  const notification = new Notification(title, options);
  notification.onclick = () => {
    window.focus();
    window.location.assign(href);
    notification.close();
  };
}
