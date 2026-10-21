import { test, expect, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111";
const email = "seller@example.test";
const user = { id: actor, email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-09T00:00:00Z" };
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })).toString("base64url")}.signature`;
const session = { access_token: token, refresh_token: "test-refresh-only", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
const profile = { data: { user_id: actor, email, account_role: "SELLER", profile_required: true } };
const applicationPath = `/p/${actor}/apply`;

for (const newAccount of [false, true]) {
  test(`application login returns after account initialization (new=${newAccount})`, async ({ page }) => {
    await setup(page);
    let initialized = !newAccount;
    let writes = 0;
    await page.route("**/api/backend/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("auth/bootstrap")) { writes++; initialized = true; return route.fulfill({ json: profile }); }
      if (url.endsWith("/me")) return route.fulfill(initialized ? { json: profile } : { status: 403, json: { code: "BOOTSTRAP_REQUIRED" } });
      if (url.endsWith("/me/seller")) return route.fulfill({ json: { data: null } });
      if (url.includes("/me/applications?")) return route.fulfill({ json: { data: [] } });
      if (url.includes("/public/projects/")) return route.fulfill({ json: { data: { project_id: actor, name: "인증 복귀 테스트 마켓", accepting_applications: true } } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto(applicationPath);
    await page.getByRole("link", { name: "로그인하고 신청 계속하기" }).click();
    await expect(page).toHaveURL(new RegExp(`/login\\?returnTo=${encodeURIComponent(applicationPath)}$`));
    await page.reload();
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByRole("button", { name: "인증번호 받기" }).click();
    await page.getByLabel("인증번호", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "인증하고 계속하기" }).click();
    await expect(page).toHaveURL(applicationPath);
    await expect(page.getByRole("heading", { name: "인증 복귀 테스트 마켓" })).toBeVisible();
    await expect(page.getByText("셀러 프로필을 먼저 작성해 주세요.")).toBeVisible();
    expect(writes).toBe(newAccount ? 1 : 0);
  });
}

test("unsafe and duplicated login return destinations stay on account", async ({ page }) => {
  await setup(page, true);
  await page.route("**/api/backend/**", (route) => route.fulfill({ json: profile }));
  for (const query of ["returnTo=https%3A%2F%2Fevil.example", `returnTo=${encodeURIComponent(applicationPath)}&returnTo=//evil.example`]) {
    await page.goto(`/account?${query}`);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp("/account\\?"));
  }
});

test("account verification failure retains destination for reauthentication", async ({ page }) => {
  await setup(page, true);
  await page.route("**/api/backend/**", (route) => route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED" } }));
  await page.goto(`/account?returnTo=${encodeURIComponent(applicationPath)}`);
  await expect(page.getByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", `/login?returnTo=${encodeURIComponent(applicationPath)}`);
  await expect(page).toHaveURL(/\/account\?/);
});

test("staff account does not automatically enter seller application", async ({ page }) => {
  await setup(page, true);
  await page.route("**/api/backend/**", (route) => route.fulfill({ json: { data: { ...profile.data, account_role: "STAFF" } } }));
  await page.goto(`/account?returnTo=${encodeURIComponent(applicationPath)}`);
  await expect(page.getByRole("link", { name: "마켓 관리하기" })).toBeVisible();
  await expect(page).toHaveURL(/\/account\?/);
});
async function setup(page: Page, signedIn = false, storedSession = session) {
  await page.route("**/api/auth/config", (route) => route.fulfill({ json: { url: "https://auth.example.test", key: "sb_publishable_test" } }));
  await page.route("https://auth.example.test/auth/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/otp")) return route.fulfill({ json: {} });
    if (url.includes("/verify")) {
      const body = route.request().postDataJSON();
      if (body.token !== "123456") return route.fulfill({ status: 403, json: { code: "otp_expired", msg: "Token expired" } });
      return route.fulfill({ json: session });
    }
    if (url.includes("/logout")) return route.fulfill({ status: 204 });
    if (url.includes("/token")) return route.fulfill({ json: session });
    return route.fulfill({ json: user });
  });
  if (signedIn) await page.addInitScript((value) => localStorage.setItem("sb-auth-auth-token", JSON.stringify(value)), storedSession);
}

test("OTP validation, busy guard, invalid code, account and logout", async ({ page }) => {
  await setup(page);
  let initialized = false; let writes = 0;
  await page.route("**/api/backend/**", (route) => {
    if (route.request().url().endsWith("auth/bootstrap")) { writes++; initialized = true; return route.fulfill({ json: profile }); }
    return route.fulfill(initialized ? { json: profile } : { status: 403, json: { code: "BOOTSTRAP_REQUIRED" } });
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "인증번호 받기" }).click();
  await expect(page.getByLabel("이메일", { exact: true })).toBeFocused();
  await expect(page.getByText("이메일 주소를 확인해 주세요.")).toBeVisible();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("이메일", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "메일을 확인해 주세요." })).toBeVisible();
  const code = page.getByLabel("인증번호", { exact: true });
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("type", "password");
  await code.fill("654321"); await code.press("Enter");
  await expect(page.getByText(/인증번호가 올바르지 않거나/)).toBeVisible();
  await code.fill("123456"); await code.press("Enter");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(email, { exact: true })).toBeVisible(); expect(writes).toBe(1);
  await page.getByRole("button", { name: "이 기기에서 로그아웃" }).click();
  await expect(page.getByText("로그인이 필요해요.")).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
});

test("lost response is recovered with same key; expires without another mutation", async ({ page }) => {
  await setup(page, true);
  const keys: string[] = []; let lookups = 0;
  await page.route("**/api/backend/**", (route) => {
    const url = route.request().url();
    if (url.includes("/me/requests/")) {
      lookups++; expect(url.endsWith(keys[0])).toBe(true);
      return route.fulfill({ status: 410, json: { code: "REQUEST_RESULT_EXPIRED" } });
    }
    if (url.endsWith("auth/bootstrap")) { keys.push(route.request().headers()["idempotency-key"]); return route.abort(); }
    return route.fulfill({ status: 403, json: { code: "BOOTSTRAP_REQUIRED" } });
  });
  await page.goto("/account");
  await expect(page.getByText("요청 결과 보관기간이 지났어요.")).toBeVisible();
  expect(keys).toHaveLength(1); expect(lookups).toBe(1);
  await page.reload();
  await expect(page.getByText("요청 결과 보관기간이 지났어요.")).toBeVisible();
  expect(keys).toHaveLength(1);
  await page.screenshot({ path: "../../output/auth-expired.png", fullPage: true });
});

test("bounded retry falls back to manual result confirmation and resumes after refresh", async ({ page }) => {
  await setup(page, true);
  let writes = 0; let resolved = false; const keys: string[] = [];
  await page.route("**/api/backend/**", (route) => {
    const url = route.request().url();
    if (url.includes("/me/requests/")) return route.fulfill(resolved ? { json: { outcome: "SUCCEEDED", http_status: 200, response: profile } } : { status: 202, json: { code: "UNRESOLVED" } });
    if (url.endsWith("auth/bootstrap")) { writes++; keys.push(route.request().headers()["idempotency-key"]); return route.fulfill({ status: 503, json: {} }); }
    return route.fulfill(resolved ? { json: profile } : { status: 403, json: { code: "BOOTSTRAP_REQUIRED" } });
  });
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "기존 요청 다시 확인" })).toBeVisible({ timeout: 25000 });
  expect(writes).toBe(4); expect(new Set(keys).size).toBe(1);
  resolved = true;
  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible(); expect(writes).toBe(4);
});

test("session rejection offers reauthentication without repeated writes", async ({ page }) => {
  await setup(page, true);
  await page.route("**/api/backend/**", (route) => route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED" } }));
  await page.goto("/account");
  await expect(page.getByText("다시 로그인이 필요해요.")).toBeVisible();
  await page.getByRole("link", { name: "다시 로그인" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("login preserves design and usable form at narrow widths and 200% text", async ({ page }) => {
  await setup(page);
  await page.goto("/login");
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: "../../output/auth-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.getByLabel("이메일", { exact: true }).boundingBox())!.y).toBeLessThan(450);
  await expect(page.getByRole("button", { name: "인증번호 받기" })).toBeInViewport();
  await page.screenshot({ path: "../../output/auth-mobile.png", fullPage: true });
  const introduction = page.locator(".auth-mobile-story summary");
  await introduction.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".auth-mobile-story")).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(page.locator(".auth-mobile-story")).not.toHaveAttribute("open", "");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({ content: "body { font-size: 32px !important; } input,button { font-size: 32px !important; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("missing provider shows honest unavailable state", async ({ page }) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({ json: { configured: false } }));
  await page.goto("/login");
  await expect(page.getByText("로그인을 준비하고 있어요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "인증번호 받기" })).toBeDisabled();
});

test("expired session refreshes through the provider before fetching profile", async ({ page }) => {
  await setup(page, true, { ...session, expires_at: Math.floor(Date.now() / 1000) - 60 });
  let refreshed = 0;
  await page.route("https://auth.example.test/auth/v1/token**", (route) => { refreshed++; return route.fulfill({ json: session }); });
  await page.route("**/api/backend/**", (route) => route.fulfill({ json: profile }));
  await page.goto("/account");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(refreshed).toBeGreaterThan(0);
});

test("logout in another tab removes the previous account immediately", async ({ page, context }) => {
  await setup(page, true);
  await page.route("**/api/backend/**", (route) => route.fulfill({ json: profile }));
  await page.goto("/account");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const second = await context.newPage();
  await setup(second);
  await second.route("**/api/backend/**", (route) => route.fulfill({ json: profile }));
  await second.goto("/account");
  await expect(second.getByText(email, { exact: true })).toBeVisible();
  await second.getByRole("button", { name: "이 기기에서 로그아웃" }).click();
  await expect(page.getByText("로그인이 필요해요.")).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
});

for (const pending of [false, true]) test(`logout server failure clears local data and preserves warning (${pending ? "pending request" : "loaded account"})`, async ({ page }) => {
  await setup(page, true);
  await page.route("https://auth.example.test/auth/v1/logout**", (route) => route.fulfill({ status: 500, json: { msg: "Unavailable" } }));
  await page.route("**/api/backend/**", (route) => {
    const url = route.request().url();
    if (!pending) return route.fulfill({ json: profile });
    if (url.endsWith("/me")) return route.fulfill({ status: 403, json: { code: "BOOTSTRAP_REQUIRED" } });
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto("/account");
  if (!pending) await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이 기기에서 로그아웃" }).click();
  await expect(page.getByText("서버 로그아웃을 확인하지 못했어요.")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "로그인하기" })).toBeVisible();
});
