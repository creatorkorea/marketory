import { test, expect, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const applicationId = "33333333-3333-4333-8333-333333333333";
const base = `/markets/${projectId}/applications`;
const user = {
  id: actor,
  email: "staff@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-10-09T00:00:00Z",
};
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })).toString("base64url")}.signature`;
const seed = {
  application_id: applicationId,
  project_id: projectId,
  status: "REVIEWING",
  version: 3,
  revision_no: 1,
  product_name: "흙빛 찻잔",
  product_desc: "손으로 빚은 생활 도자기",
  category: "공예",
  price_range: "10,000~30,000원",
  table_count: 1,
  electricity_required: false,
  fire_required: false,
  cold_storage_required: false,
  vehicle_entry_required: false,
  request_note: "",
  project: {
    project_id: projectId,
    name: "가을 마켓",
    status: "REVIEWING",
    event_end_at: "2099-11-10T09:00:00Z",
    target_team_count: 10,
    policy_json: { allowed_categories: ["공예"] },
  },
  seller: {
    shop_name: "흙빛 공방",
    owner_name: "홍길동",
    phone: "010-1234-5678",
    email: "seller@example.test",
  },
  attachments: [],
  notes: [],
  history: [],
  notice_drafts: [],
  capacity: { occupied: 9, target: 10 },
  allowed_actions: ["request_info", "approve", "wait", "reject", "note"],
  role: "OPERATOR",
  submitted_at: "2099-10-01T00:00:00Z",
  info_due_at: null as string | null,
  confirm_due_at: null as string | null,
};
async function setup(
  page: Page,
  options: {
    role?: string;
    conflict?: boolean;
    revoked?: boolean;
    lost?: boolean;
    status?: string;
    actions?: string[];
  } = {},
) {
  let app = structuredClone(seed);
  app.role = options.role ?? app.role;
  app.status = options.status ?? app.status;
  app.allowed_actions = options.actions ?? app.allowed_actions;
  if (app.role === "REVIEWER") {
    app.seller.phone = "010-****-5678";
    app.seller.email = "s***@example.test";
    app.allowed_actions = ["note"];
  }
  if (app.status === "NEED_INFO") app.info_due_at = "2099-11-01T00:00:00Z";
  const requests: {
    path: string;
    body: Record<string, unknown>;
    key: string;
  }[] = [];
  let conflict = options.conflict;
  let lost = options.lost;
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
  await page.route("**/api/backend/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/me"))
      return r.fulfill({
        json: {
          data: { user_id: actor, account_role: "STAFF", global_role: "USER" },
        },
      });
    if (path.includes("/me/requests/"))
      return r.fulfill({ json: { data: app } });
    if (r.request().method() !== "GET") {
      const body = r.request().postDataJSON();
      requests.push({
        path,
        body,
        key: r.request().headers()["idempotency-key"],
      });
      if (conflict) {
        conflict = false;
        app.version = 4;
        return r.fulfill({ status: 409, json: { code: "VERSION_CONFLICT" } });
      }
      app = {
        ...app,
        version: app.version + 1,
        ...(body.decision ? { status: String(body.decision) } : {}),
        ...(body.confirm_due_at
          ? { confirm_due_at: String(body.confirm_due_at) }
          : {}),
        ...(body.info_due_at ? { info_due_at: String(body.info_due_at) } : {}),
      };
      if (lost) {
        lost = false;
        return r.abort("connectionreset");
      }
      return r.fulfill({ json: { data: app } });
    }
    if (path.endsWith("/application-summary"))
      return r.fulfill({
        json: { data: { counts: { REVIEWING: 4 }, occupied: 9, target: 10 } },
      });
    if (path.endsWith("/applications")) {
      if (options.role === "VIEWER")
        return r.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
      const url = new URL(r.request().url());
      return r.fulfill({
        json: {
          data: {
            items: [{ ...app, shop_name: app.seller.shop_name }],
            total: 42,
            limit: Number(url.searchParams.get("limit") ?? 20),
            offset: Number(url.searchParams.get("offset") ?? 0),
            project: app.project,
            role: app.role,
          },
        },
      });
    }
    if (options.role === "VIEWER")
      return r.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
    if (options.revoked && requests.length)
      return r.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
    return r.fulfill({ json: { data: app } });
  });
  return requests;
}
test("filters, pagination and detail backlink preserve list state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  await page.goto(
    `${base}?status=REVIEWING&category=${encodeURIComponent("공예")}&offset=20`,
  );
  await expect(page.getByText("총 42건 · 21–21번째")).toBeVisible();
  expect(
    (await page.locator(".review-filters").boundingBox())!.width,
  ).toBeGreaterThan(1000);
  await page.screenshot({
    path: "../../output/review-list-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "흙빛 공방 신청 상세" }).click();
  await page.getByRole("link", { name: "신청 목록으로" }).click();
  await expect(page).toHaveURL(/offset=20/);
  await page.getByLabel("신청 상태").selectOption("WAITING");
  await page.getByRole("button", { name: "필터 적용" }).click();
  await expect(page).toHaveURL(/status=WAITING.*offset=0/);
});
test("reviewer sees masked contacts and notes without operator actions", async ({
  page,
}) => {
  await setup(page, { role: "REVIEWER" });
  await page.goto(`${base}/${applicationId}`);
  await expect(page.getByText("010-****-5678")).toBeVisible();
  await expect(page.getByText("010-1234-5678")).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: "선정", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "안내 초안 기록 · 발송 전" }),
  ).toHaveCount(0);
  await page
    .getByLabel("내부 검토 메모", { exact: true })
    .fill("상품 구성 확인");
  await page.getByRole("button", { name: "내부 메모 저장" }).click();
  await expect(page.getByText("신청 처리 내용을 저장했어요.")).toBeVisible();
});
test("viewer receives aggregate only and direct detail is denied", async ({
  page,
}) => {
  await setup(page, { role: "VIEWER" });
  await page.goto(base);
  await expect(page.getByText("집계 조회 권한입니다.")).toBeVisible();
  await expect(page.getByText("흙빛 공방")).toHaveCount(0);
  await page.goto(`${base}/${applicationId}`);
  await expect(
    page.getByText("이 신청의 상세 조회 권한이 없어요."),
  ).toBeVisible();
});
test("approval requires reason, KST deadline and a keyboard-safe confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await setup(page);
  await page.goto(`${base}/${applicationId}`);
  await page.getByRole("radio", { name: "선정", exact: true }).check();
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await expect(page.getByLabel("처리 사유", { exact: true })).toBeFocused();
  await page.getByLabel("처리 사유", { exact: true }).fill("상품 검토 완료");
  await page.getByLabel("참가확정 기한 (KST)").fill("2099-11-02 09:00");
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await expect(page.getByRole("button", { name: "돌아가기" })).toBeFocused();
  const dialogBox = await page.getByRole("dialog").boundingBox();
  expect(Math.abs(dialogBox!.x - (1440 - dialogBox!.width) / 2)).toBeLessThan(
    2,
  );
  await page.screenshot({
    path: "../../output/review-decision-dialog.png",
    fullPage: true,
  });
  expect(requests).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "선정", exact: true })
    .click();
  await expect(page.getByText("신청 처리 내용을 저장했어요.")).toBeVisible();
  expect(requests[0].body).toMatchObject({
    expected_version: 3,
    decision: "APPROVED",
    confirm_due_at: "2099-11-02T00:00:00.000Z",
  });
});
test("409 retains input and blocks new write until latest comparison is adopted", async ({
  page,
}) => {
  const requests = await setup(page, {
    conflict: true,
    actions: ["note", "request_info", "approve", "reject", "wait"],
  });
  await page.goto(`${base}/${applicationId}`);
  await page.getByRole("radio", { name: "보완 요청", exact: true }).check();
  await page.getByLabel("처리 사유", { exact: true }).fill("모집 품목 불일치");
  await page.getByLabel("보완기한 (KST)").fill("2099-11-02 09:00");
  await page.getByLabel("상품 사진", { exact: true }).check();
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "보완 요청", exact: true })
    .click();
  await expect(
    page.getByText("다른 변경이 있어 저장을 멈췄어요."),
  ).toBeVisible();
  await expect(page.getByLabel("처리 사유", { exact: true })).toHaveValue(
    "모집 품목 불일치",
  );
  await expect(
    page.getByRole("button", { name: "처리 내용 확인" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "최신 신청 확인" }).click();
  await expect(page.getByText("최신: 검토 중 · 버전 4")).toBeVisible();
  await page
    .getByRole("button", { name: "최신 상태를 확인하고 입력 유지" })
    .click();
  await expect(page.getByLabel("처리 사유", { exact: true })).toHaveValue(
    "모집 품목 불일치",
  );
  expect(requests).toHaveLength(1);
  await expect(
    page.getByRole("radio", { name: "보완 요청", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("보완기한 (KST)")).toHaveValue(
    "2099-11-02 09:00",
  );
  await expect(page.getByLabel("상품 사진", { exact: true })).toBeChecked();
});
test("revoked membership 404 removes privileged data on refresh", async ({
  page,
}) => {
  await setup(page, { conflict: true, revoked: true, role: "REVIEWER" });
  await page.goto(`${base}/${applicationId}`);
  await page.getByLabel("내부 검토 메모", { exact: true }).fill("검토 기록");
  await page.getByRole("button", { name: "내부 메모 저장" }).click();
  await page.getByRole("button", { name: "최신 신청 확인" }).click();
  await expect(page.getByText("이 신청을 조회할 권한이 없어요.")).toBeVisible();
  await expect(page.getByText("흙빛 찻잔")).toHaveCount(0);
});
test("narrow view supports correction deadline extension and retains old deadline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await setup(page, {
    status: "NEED_INFO",
    actions: ["extend_info", "note"],
  });
  await page.goto(`${base}/${applicationId}`);
  await page.getByLabel("처리 사유", { exact: true }).fill("추가 촬영 시간");
  await page.getByLabel("보완기한 (KST)").fill("2099-10-31 09:00");
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await expect(
    page.getByText("기존 기한보다 늦게 설정해 주세요."),
  ).toBeVisible();
  await page.getByLabel("보완기한 (KST)").fill("2099-11-03 09:00");
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "보완기한 연장", exact: true })
    .click();
  await expect(page.getByText("신청 처리 내용을 저장했어요.")).toBeVisible();
  expect(requests[0].body.info_due_at).toBe("2099-11-03T00:00:00.000Z");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../output/review-detail-mobile.png",
    fullPage: true,
  });
});
test("lost response recovers saved result without another mutation", async ({
  page,
}) => {
  const requests = await setup(page, { lost: true, role: "REVIEWER" });
  await page.goto(`${base}/${applicationId}`);
  await page
    .getByLabel("내부 검토 메모", { exact: true })
    .fill("검토한 자료 기록");
  await page.getByRole("button", { name: "내부 메모 저장" }).click();
  await expect(page.getByText("신청 처리 내용을 저장했어요.")).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].key).toMatch(/^[a-f0-9-]{36}$/);
});
test("request info requires fields and drafts never claim delivery", async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto(`${base}/${applicationId}`);
  await page.getByLabel("처리 사유", { exact: true }).fill("상세 사진 필요");
  await page.getByLabel("보완기한 (KST)").fill("2099-11-02 09:00");
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await expect(
    page.getByText("보완할 항목을 하나 이상 선택해 주세요."),
  ).toBeVisible();
  await page.getByLabel("상품 사진", { exact: true }).check();
  await page.getByRole("button", { name: "처리 내용 확인" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "보완 요청", exact: true })
    .click();
  await expect(page.getByText("신청 처리 내용을 저장했어요.")).toBeVisible();
  expect(requests[0].body.fields).toEqual(["product_images"]);
  await expect(
    page.getByRole("heading", { name: "안내 초안 기록 · 발송 전" }),
  ).toBeVisible();
});
