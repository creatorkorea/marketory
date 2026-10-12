import { test, expect, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const user = {
  id: actor,
  email: "admin@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-10-09T00:00:00Z",
};
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })).toString("base64url")}.signature`;
const seed = {
  project_id: id,
  name: "가을 테스트 마켓",
  venue: "테스트 광장",
  event_date: "2027-11-10",
  event_end_at: "2027-11-10T09:00:00Z",
  recruit_start_at: "2027-10-01T00:00:00Z",
  recruit_end_at: "2027-11-01T09:00:00Z",
  target_team_count: 20,
  version: 1,
  policy_version: 1,
  status: "DRAFT",
  can_manage: true,
  policy_json: {
    schema_version: 1,
    allowed_categories: ["공예"],
    restricted_items: [],
    business_required: false,
    photo_required: true,
    participation_fee_krw: 0,
    consent_version: "v1",
    consent_text: "테스트 동의",
  },
  booth_policy_json: { schema_version: 1, description: "테이블 제공" },
  evaluation_policy_json: {
    schema_version: 1,
    criteria: [{ code: "품질", weight: 100 }],
  },
};
async function setup(page: Page) {
  await page.route("**/api/auth/config", (r) =>
    r.fulfill({
      json: { url: "https://auth.example.test", key: "sb_publishable_test" },
    }),
  );
  await page.route("https://auth.example.test/auth/v1/**", (r) =>
    r.fulfill({ json: user }),
  );
  await page.addInitScript(
    (value) =>
      localStorage.setItem("sb-auth-auth-token", JSON.stringify(value)),
    {
      access_token: token,
      refresh_token: "test-only",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    },
  );
}
test("create draft, edit, conflict preserves input, status and member confirmation", async ({
  page,
}) => {
  await setup(page);
  let project: Record<string, unknown> = { ...seed };
  let writes = 0;
  let conflict = false;
  let membership = false;
  await page.route("**/api/backend/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/me"))
      return r.fulfill({
        json: {
          data: {
            user_id: actor,
            account_role: "STAFF",
            global_role: "PLATFORM_ADMIN",
            can_create_project: true,
          },
        },
      });
    if (r.request().method() !== "GET") {
      writes++;
      const body = r.request().postDataJSON();
      expect(r.request().headers()["idempotency-key"]).toMatch(
        /^[a-f0-9-]{36}$/,
      );
      if (conflict) {
        conflict = false;
        return r.fulfill({ status: 409, json: { code: "VERSION_CONFLICT" } });
      }
      if (path.endsWith("/members")) membership = true;
      else project = { ...project, ...body };
      project.version = writes;
      return r.fulfill({
        status: path.endsWith("/projects") ? 201 : 200,
        json: { data: project },
      });
    }
    if (path.endsWith("/members"))
      return r.fulfill({
        json: {
          data: membership
            ? [
                {
                  user_id: actor,
                  email: "operator@example.test",
                  role: "OPERATOR",
                  active: true,
                },
              ]
            : [],
        },
      });
    if (path.endsWith("/settings"))
      return r.fulfill({ json: { data: project } });
    return r.fulfill({ json: { data: [] } });
  });
  await page.goto("/markets/new");
  await page.getByRole("button", { name: "초안 만들기" }).click();
  await expect(page.getByLabel("마켓 이름", { exact: true })).toBeFocused();
  const values = {
    "마켓 이름": "가을 테스트 마켓",
    장소: "테스트 광장",
    "모집 시작": "2027-10-01 09:00",
    "모집 마감": "2027-11-01 18:00",
    "행사 종료": "2027-11-10 18:00",
    "모집 정원 (팀)": "20",
    "모집 품목": "공예",
    "동의 문구 버전": "v1",
    "참가 동의 문구": "테스트 동의",
    "심사 항목과 비중": "품질:100",
    "부스 제공 조건": "테이블 제공",
    "저장 사유": "최초 등록",
  };
  for (const [label, value] of Object.entries(values))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "초안 만들기" }).click();
  await expect(page).toHaveURL(`/markets/${id}`);
  await expect(page.getByLabel("장소", { exact: true })).toHaveValue(
    "테스트 광장",
  );
  expect(writes).toBe(1);
  await page.getByLabel("장소", { exact: true }).fill("새 장소");
  await page.getByLabel("저장 사유", { exact: true }).fill("장소 변경");
  conflict = true;
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(
    page.getByText("다른 변경이 있어 저장을 멈췄어요."),
  ).toBeVisible();
  await expect(page.getByLabel("장소", { exact: true })).toHaveValue("새 장소");
  await page.getByRole("button", { name: "최신 마켓 확인" }).click();
  await page.getByRole("button", { name: "최신 내용으로 입력 바꾸기" }).click();
  await page.getByLabel("장소", { exact: true }).fill("새 장소");
  await page.getByLabel("저장 사유", { exact: true }).fill("검토 후 변경");
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(
    page.getByText("마켓 변경 사항을 저장했어요.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("모집 공개", { exact: true }).check();
  await page.getByLabel("상태 변경 사유", { exact: true }).fill("모집 시작");
  await page.getByRole("button", { name: "변경 내용 확인" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "돌아가기" })).toBeFocused();
  await page.keyboard.press("Escape");
  expect(writes).toBe(3);
  await page.getByRole("button", { name: "변경 내용 확인" }).click();
  await page.getByRole("button", { name: "상태 변경하기" }).click();
  await expect(page.getByText(/모집 공개 · 버전/)).toBeVisible();
  await page.getByLabel("배정할 이메일").fill("operator@example.test");
  await page.getByLabel("운영자", { exact: true }).check();
  await page.getByLabel("권한 변경 사유").fill("행사 운영 담당");
  await page.getByRole("button", { name: "권한 변경 확인" }).click();
  await page.getByRole("button", { name: "권한 배정하기" }).click();
  await expect(
    page.getByText("operator@example.test · 운영자 · 활성"),
  ).toBeVisible();
});
test("reload with unresolved request only looks up result, never creates a new mutation", async ({
  page,
}) => {
  await setup(page);
  let writes = 0;
  let lookups = 0;
  await page.addInitScript(
    ({ actor, id }) =>
      sessionStorage.setItem(
        `marketory:mutation:${actor}:${id}`,
        JSON.stringify({
          key: "33333333-3333-4333-8333-333333333333",
          operation: "projects.update",
          path: `projects/${id}`,
          method: "PATCH",
        }),
      ),
    { actor, id },
  );
  await page.route("**/api/backend/**", (r) => {
    const url = r.request().url();
    if (r.request().method() !== "GET") writes++;
    if (url.endsWith("/me"))
      return r.fulfill({
        json: {
          data: {
            account_role: "STAFF",
            global_role: "PLATFORM_ADMIN",
            can_create_project: true,
          },
        },
      });
    if (url.includes("/me/requests/")) {
      lookups++;
      return r.fulfill({ status: 202, json: { code: "UNRESOLVED" } });
    }
    return r.fulfill({ json: { data: url.endsWith("/members") ? [] : seed } });
  });
  await page.goto(`/markets/${id}`);
  await page.getByRole("button", { name: "기존 요청 다시 확인" }).click();
  await expect(page.getByText("처리 결과를 확인하지 못했어요.")).toBeVisible();
  expect(lookups).toBe(1);
  expect(writes).toBe(0);
  await expect(page.getByRole("button", { name: "설정 저장" })).toBeDisabled();
});
test("empty list, seller denial, narrow layout and keyboard navigation", async ({
  page,
}) => {
  await setup(page);
  let seller = false;
  await page.route("**/api/backend/**", (r) =>
    r.fulfill({
      json: {
        data: r.request().url().endsWith("/me")
          ? {
              account_role: seller ? "SELLER" : "STAFF",
              global_role: seller ? "USER" : "PLATFORM_ADMIN",
              can_create_project: !seller,
            }
          : [],
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/markets");
  await expect(page.getByText("아직 등록된 마켓이 없어요.")).toBeVisible();
  await page.getByRole("link", { name: "새 마켓 만들기" }).click();
  await page.getByLabel("마켓 이름", { exact: true }).fill("저장 전 입력");
  await page.getByRole("link", { name: "마켓 목록", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("마켓 이름", { exact: true })).toHaveValue(
    "저장 전 입력",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // A cancelled traversal deliberately never reaches a new load state.
  await page.goBack({ timeout: 2000 }).catch(() => {});
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("마켓 이름", { exact: true })).toHaveValue(
    "저장 전 입력",
  );
  seller = true;
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.getByText("마켓 운영 권한이 필요해요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "초안 만들기" })).toHaveCount(
    0,
  );
});
test("reviewer and unassigned staff cannot open creation form", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/backend/me", (r) =>
    r.fulfill({
      json: {
        data: {
          account_role: "STAFF",
          global_role: "USER",
          can_create_project: false,
        },
      },
    }),
  );
  await page.goto("/markets/new");
  await expect(page.getByText("새 마켓 생성 권한이 필요해요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "초안 만들기" })).toHaveCount(
    0,
  );
});

for (const role of ["STAFF", "SELLER"]) {
  test(`initial ${role} access retries temporary failures and supports manual recovery`, async ({ page }) => {
    await setup(page);
    let reads = 0, writes = 0;
    await page.route("**/api/backend/**", async route => {
      if (route.request().method() !== "GET") writes++;
      if (new URL(route.request().url()).pathname.endsWith("/me")) {
        reads++;
        if (reads <= 3) return route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
        return route.fulfill({ json: { data: { user_id: actor, account_role: role, global_role: role === "STAFF" ? "PLATFORM_ADMIN" : "USER" } } });
      }
      return route.fulfill({ json: { data: { items: [], total: 0 } } });
    });
    await page.goto(role === "STAFF" ? "/markets" : "/me/applications");
    await expect(page.getByText("연결을 다시 확인하고 있어요.")).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeVisible({ timeout: 12000 });
    expect(reads).toBe(3);
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(page.getByText(role === "STAFF" ? "운영 정보를 불러오지 못했어요." : "셀러 정보를 불러오지 못했어요.")).toHaveCount(0);
    await expect.poll(() => reads).toBe(4);
    expect(writes).toBe(0);
  });
}

test("slow initial access explains waiting without restarting the request", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route("**/api/backend/**", async route => {
    if (new URL(route.request().url()).pathname.endsWith("/me")) {
      reads++;
      await gate;
      return route.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
    }
    return route.fulfill({ json: { data: { items: [], total: 0 } } });
  });
  await page.goto("/markets");
  await expect(page.getByText(/연결에 시간이 걸리고 있어요/)).toBeVisible({ timeout: 12000 });
  expect(reads).toBe(1);
  await page.screenshot({ path: "../../output/access-slow-desktop.png", fullPage: true });
  release();
  await expect(page.getByText("마켓 운영 권한이 필요해요.")).toBeVisible();
  expect(reads).toBe(1);
});
