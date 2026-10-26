// Shows a notice when a run settles, unless this session is already on screen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => event.waitUntil(showNotice(event.data ? event.data.json() : {})));
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openSession(event.notification.data?.sessionId ?? ""));
});

async function showNotice(notice) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const isWatching = windows.some(
    (client) =>
      client.focused && client.visibilityState === "visible" && new URL(client.url).hash === `#${notice.sessionId}`,
  );
  if (notice.sessionId && isWatching) return;
  await self.registration.showNotification(notice.title || "pi remote", {
    body: notice.body,
    tag: notice.sessionId || "pi-remote",
    icon: "/icon-192.png",
    data: { sessionId: notice.sessionId },
  });
}

async function openSession(sessionId) {
  const [client] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!client) return self.clients.openWindow(`/#${sessionId}`);
  await client.focus();
  client.postMessage({ type: "open_session", sessionId });
}
