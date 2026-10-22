import { test, expect, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111",
  pid = "22222222-2222-4222-8222-222222222222",
  aid = "55555555-5555-4555-8555-555555555555";
const user = {
  id: actor,
  email: "staff@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-10-01T00:00:00Z",
};
const seed = {
  announcement_id: aid,
  project_id: pid,
  subject: "공통 테스트 안내",
  body: "입장 안내",
  audience: "CONFIRMED",
  content_version: 1,
  version: 1,
  approved_version: null as number | null,
  approved_at: null as string | null,
  created_at: "2026-10-22T00:00:00Z",
  updated_at: "2026-10-22T00:00:00Z",
  publication: null as null | Record<string, unknown>,
  allowed_actions: ["revise", "approve"],
};
async function setup(page: Page, pending?: string) {
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })).toString("base64url")}.signature`;
  await page.route("**/api/auth/config", (r) =>
    r.fulfill({
      json: { url: "https://auth.example.test", key: "sb_publishable_test" },
    }),
  );
  await page.route("https://auth.example.test/auth/v1/**", (r) =>
    r.fulfill({ json: user }),
  );
  await page.addInitScript(
    ({ user, token, actor, pid, aid, pending }) => {
      localStorage.setItem(
        "sb-auth-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      );
      if (pending)
        sessionStorage.setItem(
          `marketory:mutation:${actor}:announcements:${pid}`,
          JSON.stringify({
            key: aid,
            operation: `announcements.${pending}`,
            path:
              pending === "create"
                ? `projects/${pid}/announcements`
                : `announcements/${aid}/${pending}`,
            method: "POST",
          }),
        );
    },
    { user, token, actor, pid, aid, pending },
  );
  let message = structuredClone(seed);
  const writes: string[] = [];
  await page.route("**/api/backend/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/me"))
      return r.fulfill({
        json: {
          data: { user_id: actor, account_role: "STAFF", global_role: "USER" },
        },
      });
    if (path.includes("/me/requests/"))
      return r.fulfill({ json: { data: message } });
    if (r.request().method() !== "GET") {
      writes.push(path);
      const b = r.request().postDataJSON();
      message.version++;
      if (path.endsWith("/announcements") || path.endsWith("/revise")) {
        Object.assign(message, {
          subject: b.subject,
          body: b.body,
          audience: b.audience,
          approved_version: null,
          allowed_actions: ["revise", "approve"],
        });
        if (path.endsWith("/revise")) message.content_version++;
      }
      if (path.endsWith("/approve"))
        Object.assign(message, {
          approved_version: message.content_version,
          allowed_actions: ["revise", "publish"],
        });
      if (path.endsWith("/publish"))
        Object.assign(message, {
          publication: {
            subject: message.subject,
            body: message.body,
            audience: message.audience,
            content_version: message.content_version,
            published_at: seed.created_at,
            withdrawn_at: null,
          },
          allowed_actions: ["revise", "unpublish"],
        });
      if (path.endsWith("/unpublish"))
        Object.assign(message, {
          publication: {
            ...message.publication,
            withdrawn_at: seed.created_at,
          },
          allowed_actions: ["revise", "publish"],
        });
      return r.fulfill({
        status: path.endsWith("/announcements") ? 201 : 200,
        json: { data: message },
      });
    }
    if (path.endsWith("/announcements"))
      return r.fulfill({
        json: {
          data: {
            items: [message],
            total: 1,
            limit: 20,
            offset: 0,
            project: { project_id: pid, name: "테스트 마켓" },
          },
        },
      });
    return r.fulfill({ json: { data: message } });
  });
  return writes;
}
test("공통 안내 작성 승인 게시 내리기와 미저장 보호", async ({ page }) => {
  await setup(page);
  await page.goto(`/markets/${pid}/announcements`);
  await expect(page.getByLabel("공개 대상")).toHaveValue("CONFIRMED");
  await page.getByLabel("공개 대상").selectOption("ALL_APPLICANTS");
  await expect(page.getByText(/미선정자도 포함/)).toBeVisible();
  await page.getByLabel("제목", { exact: true }).fill("공통 테스트 안내");
  await page.getByLabel("본문", { exact: true }).fill("입장 안내");
  await page.getByLabel("처리 사유").fill("검증");
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "내용 승인", exact: true }),
  ).toBeVisible();
  await page.getByLabel("본문", { exact: true }).fill("변경");
  await expect(
    page.getByRole("button", { name: "내용 승인", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("본문", { exact: true }).fill("입장 안내");
  for (const name of ["내용 승인", "셀러에게 게시", "게시 내리기"]) {
    await page.getByLabel("처리 사유").fill("검증");
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("전체 신청자");
    await page
      .getByRole("dialog")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(
    page.getByRole("heading", { name: "게시 내림", exact: true }),
  ).toBeVisible();
});
for (const op of ["create", "revise", "approve", "publish", "unpublish"])
  test(`공통 안내 ${op} 저장 응답 복구`, async ({ page }) => {
    const writes = await setup(page, op);
    await page.goto(`/markets/${pid}/announcements`);
    await page.getByRole("button", { name: "기존 요청 다시 확인" }).click();
    await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
      seed.subject,
    );
    expect(writes).toHaveLength(0);
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith("marketory:mutation:"),
        ),
      ),
    ).toEqual([]);
  });

test("공통 안내 충돌 입력 보존과 최신판 재검토", async ({ page }) => {
  await setup(page);
  await page.goto(`/markets/${pid}/announcements`);
  await page.getByRole("button", { name: seed.subject, exact: true }).click();
  await page.getByLabel("본문", { exact: true }).fill("내 수정 본문");
  await page.getByLabel("처리 사유").fill("수정");
  await page.route(`**/api/backend/announcements/${aid}/revise`, (r) =>
    r.fulfill({ status: 409, json: { code: "VERSION_CONFLICT" } }),
  );
  await page.route(`**/api/backend/announcements/${aid}`, (r) =>
    r.fulfill({
      json: {
        data: {
          ...seed,
          body: "다른 운영자의 최신 본문",
          version: 2,
          content_version: 2,
        },
      },
    }),
  );
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await page.getByRole("button", { name: "최신 마켓 확인" }).click();
  await expect(
    page.getByText("다른 운영자의 최신 본문", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("본문", { exact: true })).toHaveValue(
    "내 수정 본문",
  );
  await page
    .getByRole("button", { name: "입력은 유지하고 최신 버전으로 다시 검토" })
    .click();
  await expect(
    page.getByRole("button", { name: "내용 승인", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../output/announcements-operator-320.png",
    fullPage: true,
  });
});
