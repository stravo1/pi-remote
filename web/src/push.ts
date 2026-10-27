// Web Push needs a service worker. iOS offers it only in an app added to the Home Screen.

/**
 * Answers the worker's "which session is on screen?" during a push. The worker
 * cannot read the page's hash itself: a client's url is its creation URL, and
 * a same-document hash change never updates it.
 */
export function answerSessionQueries(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "which_session") return;
    event.source?.postMessage({
      type: "viewing_session",
      sessionId: location.hash.slice(1),
      visible: document.visibilityState === "visible",
    });
  });
}

export class DevicePush {
  get is_supported(): boolean {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  get permission(): NotificationPermission {
    return this.is_supported ? Notification.permission : "default";
  }

  // A subscription made with an older server key cannot receive pushes, so it is dropped.
  async getSubscription(publicKey: string): Promise<PushSubscription | null> {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription || hasKey(subscription, publicKey)) return subscription;
    await subscription.unsubscribe();
    return null;
  }

  async subscribe(publicKey: string): Promise<PushSubscription> {
    if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked.");
    const registration = await navigator.serviceWorker.register("/sw.js");
    return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) });
  }

  async unsubscribe(publicKey: string): Promise<string | undefined> {
    const subscription = await this.getSubscription(publicKey);
    await subscription?.unsubscribe();
    return subscription?.endpoint;
  }
}

function hasKey(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options.applicationServerKey;
  return !key || new Uint8Array(key).join() === decodeKey(publicKey).join();
}

/**
 * Remembers the toggle choice. iOS drops the browser's own push subscription at each
 * home-screen web app launch, so a missing subscription alone cannot mean "off".
 */
const pushChoiceKey = "pi-remote.push";

export function readPushChoice(): boolean {
  try {
    return localStorage.getItem(pushChoiceKey) !== "off";
  } catch {
    return false;
  }
}

export function writePushChoice(isOn: boolean): void {
  try {
    localStorage.setItem(pushChoiceKey, isOn ? "on" : "off");
  } catch {
    // Storage can be unavailable, and then each launch just re-checks the subscription.
  }
}

export function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
