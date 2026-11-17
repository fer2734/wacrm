import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockRole = "owner";
let mockInviteOk = true;
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { account_role: mockRole } }) }) }) }),
    rpc: async () => ({ data: { ok: mockInviteOk }, error: null }),
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  mockRole = "owner";
  mockInviteOk = true;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe("middleware — every dashboard route requires a session", () => {
  // Read the route group rather than hard-coding a list, so a new page added
  // under src/app/(dashboard)/ fails here until it is added to
  // protectedPaths. /flows, /agents and /notifications were missed that way
  // and rendered a broken page to signed-out visitors instead of redirecting.
  const dashboardRoutes = readdirSync(join(__dirname, "app", "(dashboard)"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);

  it("finds the dashboard route group", () => {
    expect(dashboardRoutes).toContain("/dashboard");
  });

  it.each(dashboardRoutes)("redirects a signed-out visitor from %s to /login", async (route) => {
    mockUser = null;

    const res = await middleware(new NextRequest(`https://app.test${route}`));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});


describe("team onboarding and assigned-agent navigation", () => {
  const token = "a".repeat(43);
  it("remembers an invite before the user signs up", async () => {
    const res = await middleware(new NextRequest(`https://app.test/join/${token}`));
    expect(res.cookies.get("wacrm_invitation")?.value).toBe(token);
    expect(res.cookies.get("wacrm_invitation")?.httpOnly).toBe(true);
  });
  it("returns a confirmed user to their pending invitation", async () => {
    mockUser = { id: "user-1" };
    const res = await middleware(new NextRequest("https://app.test/dashboard", { headers: { cookie: `wacrm_invitation=${token}` } }));
    expect(res.headers.get("location")).toContain(`/join/${token}`);
  });
  it("clears a used invitation and opens the agent inbox", async () => {
    mockUser = { id: "agent" }; mockRole = "agent"; mockInviteOk = false;
    const res = await middleware(new NextRequest("https://app.test/dashboard", { headers: { cookie: `wacrm_invitation=${token}` } }));
    expect(res.headers.get("location")).toContain("/inbox");
    expect(res.cookies.get("wacrm_invitation")?.value).toBe("");
  });
  it("sends agents away from WhatsApp setup", async () => {
    mockUser = { id: "agent" }; mockRole = "agent";
    const res = await middleware(new NextRequest("https://app.test/settings?tab=whatsapp"));
    expect(res.headers.get("location")).toContain("/settings?tab=profile");
  });
  it("allows an agent to open their sales funnel", async () => {
    mockUser = { id: "agent" }; mockRole = "agent";
    const res = await middleware(new NextRequest("https://app.test/pipelines"));
    expect(res.headers.get("location")).toBeNull();
  });
  it("keeps personal settings available to agents", async () => {
    mockUser = { id: "agent" }; mockRole = "agent";
    const res = await middleware(new NextRequest("https://app.test/settings?tab=security"));
    expect(res.headers.get("location")).toBeNull();
  });
  it("blocks an agent from running a shared broadcast", async () => {
    mockUser = { id: "agent" }; mockRole = "agent";
    const res = await middleware(new NextRequest("https://app.test/api/whatsapp/broadcast", { method: "POST" }));
    expect(res.status).toBe(403);
  });
});
