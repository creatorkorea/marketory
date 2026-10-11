import { test, expect, type Page } from "@playwright/test";
import type { Board, Assignment } from "../../lib/booths/form";
const actor = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const applicationId = "33333333-3333-4333-8333-333333333333";
const boothId = "44444444-4444-4444-8444-444444444444";
const base = `/markets/${projectId}/booths`;
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
const seed: Board = {
  project: {
    project_id: projectId,
    name: "가을 숲길 마켓",
    status: "CLOSED",
    event_end_at: "2099-11-10T09:00:00Z",
    version: 4,
  },
  role: "OPERATOR",
  can_manage: true,
  booths: [
    {
      booth_id: boothId,
      project_id: projectId,
      booth_no: "A-01",
      zone: "숲길",
      electricity_available: true,
      fire_allowed: false,
      cold_storage_available: false,
      vehicle_access: true,
      table_capacity: 2,
      note: "입구 가까운 자리",
      status: "AVAILABLE",
      version: 1,
    },
  ],
  applications: [
    {
      application_id: applicationId,
      version: 2,
      shop_name: "흙빛 공방",
      product_name: "손으로 빚은 찻잔",
      category: "공예",
      electricity_required: false,
      fire_required: false,
      cold_storage_required: false,
      vehicle_entry_required: false,
      table_count: 1,
    },
  ],
  assignments: [],
  drafts: [],
  history: [],
  unassigned_count: 1,
  candidates: [
    {
      application_id: applicationId,
      booth_id: boothId,
      compatible: true,
      conflicts: [],
      warnings: ["같은 구역에 같은 카테고리 셀러가 있어요."],
    },
  ],
};
async function setup(
  page: Page,
  options: {
    conflict?: boolean;
    changedDraft?: boolean;
    lost?: boolean;
    reviewer?: boolean;
    forbidden?: boolean;
    confirmed?: boolean;
    empty?: boolean;
    missing?: boolean;
    expired?: boolean;
  } = {},
) {
  let board = structuredClone(seed);
  if (options.reviewer) {
    board.role = "REVIEWER";
    board.can_manage = false;
  }
  if (options.expired) {
    board.project.event_end_at = "2020-01-01T00:00:00Z";
    board.can_manage = false;
  }
  if (options.empty) {
    board.applications = [];
    board.booths = [];
    board.candidates = [];
    board.unassigned_count = 0;
  }
  const assignment: Assignment = {
    assignment_id: "55555555-5555-4555-8555-555555555555",
    application_id: applicationId,
    booth_id: boothId,
    confirmed: false,
    version: 1,
    input_application_version: 2,
    input_booth_version: 1,
    reason: "배치",
    assigned_at: "2026-10-09T00:00:00Z",
    confirmed_at: null,
    released_at: null,
    release_reason: null,
  };
  if (options.confirmed) {
    board.assignments = [{ ...assignment, confirmed: true }];
    board.unassigned_count = 0;
  }
  const requests: {
    path: string;
    body: Record<string, unknown>;
    key: string;
  }[] = [];
  let conflict = options.conflict;
  let lost = options.lost;
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: { url: "https://auth.example.test", key: "sb_publishable_test" },
    }),
  );
  await page.route("https://auth.example.test/auth/v1/**", (route) =>
    route.fulfill({ json: user }),
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
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me"))
      return route.fulfill({
        json: {
          data: { user_id: actor, account_role: "STAFF", global_role: "USER" },
        },
      });
    if (path.includes("/me/requests/"))
      return route.fulfill({ json: { data: board } });
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      requests.push({
        path,
        body,
        key: route.request().headers()["idempotency-key"],
      });
      if (conflict) {
        conflict = false;
        board.project.version += 1;
        board.booths[0].table_capacity = 3;
        if (options.changedDraft) board.drafts = [assignment];
        return route.fulfill({
          status: 409,
          json: { code: "VERSION_CONFLICT" },
        });
      }
      board.project.version += 1;
      if (path.endsWith("/booth-draft"))
        board.drafts = body.items.map(
          (item: { application_id: string; booth_id: string }) => ({
            ...assignment,
            ...item,
          }),
        );
      else if (path.endsWith("/booth-confirm")) {
        board.assignments = board.drafts.map((item) => ({
          ...item,
          confirmed: true,
        }));
        board.drafts = [];
        board.unassigned_count = 0;
      } else if (path.endsWith("/booth-release")) {
        board.history = board.assignments.map((item) => ({
          ...item,
          released_at: "2026-10-09T01:00:00Z",
          release_reason: String(body.reason),
        }));
        board.assignments = [];
        board.drafts = [];
        board.unassigned_count = 1;
      } else if (route.request().method() === "PATCH")
        board.booths[0] = { ...board.booths[0], ...body };
      else
        board.booths.push({
          ...board.booths[0],
          ...body,
          booth_id: "66666666-6666-4666-8666-666666666666",
        });
      if (lost) {
        lost = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: { data: board } });
    }
    if (options.forbidden)
      return route.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
    if (options.missing)
      return route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
    return route.fulfill({ json: { data: board } });
  });
  await page.goto(base);
  return requests;
}
test("draft selection, candidate warning, explicit confirmation and keyboard dialog", async ({
  page,
}) => {
  const requests = await setup(page);
  const choice = page.getByLabel("흙빛 공방 변경할 부스");
  await choice.focus();
  await choice.press("ArrowDown");
  await choice.press("Enter");
  await expect(choice).toHaveValue(boothId);
  await expect(
    page.getByText("같은 구역에 같은 카테고리 셀러가 있어요.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("초안 저장 사유").fill("시설 조건 확인");
  await page
    .getByRole("button", { name: "배치 초안 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "저장된 초안 확정" }),
  ).toBeEnabled();
  expect(requests[0].body.items).toEqual([
    {
      application_id: applicationId,
      booth_id: boothId,
      expected_application_version: 2,
    },
  ]);
  await page.getByRole("button", { name: "저장된 초안 확정" }).click();
  await expect(
    page.getByRole("button", { name: "돌아가기", exact: true }),
  ).toBeFocused();
  expect(requests).toHaveLength(1);
  await page.getByLabel("처리 사유", { exact: true }).fill("운영자 최종 검토");
  await page
    .getByRole("button", { name: "부스 배치 확정", exact: true })
    .click();
  await expect(page.getByText("부스 배치를 확정했어요.")).toBeVisible();
  expect(requests[1].body.expected_version).toBe(5);
  expect(requests.every((request) => request.key.length === 36)).toBe(true);
});
test("resource conflict preserves input and compares latest before retry", async ({
  page,
}) => {
  const requests = await setup(page, { conflict: true, changedDraft: true });
  await page.getByRole("button", { name: "A-01 부스 수정" }).click();
  await page.getByLabel("부스 번호", { exact: true }).fill("A-02");
  await page.getByLabel("등록·수정 사유").fill("번호 정리");
  await page.getByRole("button", { name: "부스 수정 저장" }).click();
  await expect(
    page.getByText("다른 변경이 있어 저장을 멈췄어요."),
  ).toBeVisible();
  await expect(page.getByLabel("부스 번호", { exact: true })).toHaveValue(
    "A-02",
  );
  await page.getByRole("button", { name: "최신 마켓 확인" }).click();
  await expect(
    page.getByText("최신 내용과 내 입력을 비교해 주세요."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "최신 기준으로 내 입력 다시 검토" })
    .click();
  await expect(page.getByLabel("부스 번호", { exact: true })).toHaveValue(
    "A-02",
  );
  await page.getByRole("button", { name: "부스 수정 저장" }).click();
  await expect(page.getByText("저장했어요.", { exact: true })).toBeVisible();
  expect(requests[1].body.expected_version).toBe(5);
});
test("lost response recovers without second mutation", async ({ page }) => {
  const requests = await setup(page, { lost: true });
  await page.getByLabel("흙빛 공방 변경할 부스").selectOption(boothId);
  await page.getByLabel("초안 저장 사유").fill("초안 검토");
  await page
    .getByRole("button", { name: "배치 초안 저장", exact: true })
    .click();
  await expect(page.getByText("저장했어요.", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
});
test("release requires explicit reason and shows history", async ({ page }) => {
  const requests = await setup(page, { confirmed: true });
  await page.getByRole("button", { name: "흙빛 공방 배정 해제" }).click();
  await page.getByRole("button", { name: "배정 해제", exact: true }).click();
  await expect(page.getByLabel("처리 사유", { exact: true })).toBeFocused();
  expect(requests).toHaveLength(0);
  await page.getByLabel("처리 사유", { exact: true }).fill("운영 동선 변경");
  await page.getByRole("button", { name: "배정 해제", exact: true }).click();
  await expect(page.getByText("부스 배정을 해제했어요.")).toBeVisible();
  await expect(page.getByText("운영 동선 변경", { exact: true })).toBeVisible();
});
test("reviewer read-only and forbidden/missing states", async ({ page }) => {
  await setup(page, { reviewer: true });
  await expect(page.getByText("배치 현황을 조회하고 있어요.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "부스 등록 저장" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("흙빛 공방 변경할 부스")).toHaveCount(0);
});
test("forbidden board does not expose seller data", async ({ page }) => {
  await setup(page, { forbidden: true });
  await expect(page.getByText("부스 배치 조회 권한이 없어요.")).toBeVisible();
  await expect(page.getByText("흙빛 공방", { exact: true })).toHaveCount(0);
});
test("empty board allows new resources and validates fields", async ({
  page,
}) => {
  await setup(page, { empty: true });
  await expect(page.getByText("등록된 부스가 없어요.")).toBeVisible();
  await page.getByRole("button", { name: "부스 등록 저장" }).click();
  await expect(page.getByLabel("부스 번호", { exact: true })).toBeFocused();
  await expect(page.getByText("부스 번호를 입력해 주세요.")).toBeVisible();
});
test("mobile no overflow, unsaved guard and resource/draft isolation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.getByLabel("흙빛 공방 변경할 부스")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../output/booths-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("흙빛 공방 변경할 부스").selectOption(boothId);
  await expect(
    page.getByRole("button", { name: "부스 등록 저장" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "마켓 목록", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "이 화면을 나갈까요?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "돌아가기", exact: true }).click();
  await expect(page.getByLabel("흙빛 공방 변경할 부스")).toHaveValue(boothId);
});
test("desktop evidence and ended event read-only", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, { expired: true });
  await expect(
    page.getByText("행사가 종료되어 배치를 변경할 수 없어요."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "부스 등록 저장" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "../../output/booths-desktop.png",
    fullPage: true,
  });
});
