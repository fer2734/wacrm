import { afterEach, describe, expect, it, vi } from "vitest";
import { showBrowserNotification } from "./show-browser-notification";

afterEach(() => vi.unstubAllGlobals());

describe("system notification delivery", () => {
  it("uses service-worker notifications on Android without calling the constructor", async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const register = vi.fn().mockResolvedValue({});
    const constructor = vi.fn(() => { throw new Error("Illegal constructor on Android"); });
    Object.assign(constructor, { permission: "granted" });
    vi.stubGlobal("Notification", constructor);
    vi.stubGlobal("window", { Notification: constructor });
    vi.stubGlobal("navigator", { serviceWorker: { register, ready: Promise.resolve({ showNotification }) } });
    await showBrowserNotification("Cliente", { body: "Hola", tag: "c1" }, "/inbox?c=c1");
    expect(register).toHaveBeenCalledWith("/notifications-sw.js", { scope: "/" });
    expect(showNotification).toHaveBeenCalledWith("Cliente", { body: "Hola", tag: "c1", data: { href: "/inbox?c=c1" } });
    expect(constructor).not.toHaveBeenCalled();
  });

  it("rejects blocked permissions so the caller can show an in-app alert", async () => {
    const notification = { permission: "denied" };
    vi.stubGlobal("window", { Notification: notification });
    vi.stubGlobal("Notification", notification);
    await expect(showBrowserNotification("Cliente", {}, "/inbox")).rejects.toThrow("not permitted");
  });

  it("surfaces worker failures for the in-app fallback", async () => {
    const notification = { permission: "granted" };
    vi.stubGlobal("window", { Notification: notification });
    vi.stubGlobal("Notification", notification);
    vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn().mockRejectedValue(new Error("Unavailable")) } });
    await expect(showBrowserNotification("Cliente", {}, "/inbox")).rejects.toThrow("Unavailable");
  });
});
