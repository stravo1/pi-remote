// Shows a notice when a run settles, unless this session is already on screen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => event.waitUntil(showNotice(event.data ? event.data.json() : {})));
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openSession(event.notification.data?.sessionId ?? ""));
});

async function showNotice(notice) {
  // A client's `url` is its creation URL, which a same-document hash change
  // never updates, so it cannot say which session the page shows. Ask instead.
  if (notice.sessionId && (await isSessionOnScreen(notice.sessionId))) return;
  await self.registration.showNotification(notice.title || "pi remote", {
    body: notice.body,
    tag: notice.sessionId || "pi-remote",
    icon: "/icon-192.png",
    data: { sessionId: notice.sessionId },
  });
}

async function isSessionOnScreen(sessionId) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const replies = [];
  const reply = (event) => {
    if (event.data?.type === "viewing_session") replies.push(event.data);
  };
  self.addEventListener("message", reply);
  try {
    for (const client of windows) client.postMessage({ type: "which_session" });
    // The push handler must not stall, so bound the wait for page replies.
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      if (replies.some((r) => r.visible && r.sessionId === sessionId)) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return replies.some((r) => r.visible && r.sessionId === sessionId);
  } finally {
    self.removeEventListener("message", reply);
  }
}

async function openSession(sessionId) {
  const [client] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!client) return self.clients.openWindow(`/#${sessionId}`);
  await client.focus();
  client.postMessage({ type: "open_session", sessionId });
}
