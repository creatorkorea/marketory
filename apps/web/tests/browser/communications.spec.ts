import { test, expect, type Page } from "@playwright/test";
import type { Message } from "../../lib/communications/form";
const actor = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const applicationId = "33333333-3333-4333-8333-333333333333";
const boothId = "44444444-4444-4444-8444-444444444444";
const base = `/markets/${projectId}/communications`;
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
const cid = "55555555-5555-4555-8555-555555555555";
const seed: Message = {
  communication_id: cid,
  project_id: projectId,
  application_id: applicationId,
  type: "BOOTH",
  subject: "가을 숲길 마켓 부스 안내",
  body: "흙빛 공방님, A-01 부스에서 만나요.\n운영 시간을 확인해 주세요.",
  recipient_snapshot: "seller@example.test",
  send_status: "DRAFT",
  version: 1,
  content_version: 1,
  approved_version: null,
  approved_at: null,
  sent_at: null,
  failure_reason: null,
  supersedes_id: null,
  superseded_at: null,
  created_at: "2026-10-11T00:00:00Z",
  allowed_actions: ["revise", "approve"],
  attempts: [],
  resolutions: [],
};
async function setup(
  page: Page,
  options: {
    conflict?: boolean;
    unknown?: boolean;
    denied?: boolean;
    empty?: boolean;
    pending?: boolean;
    lost?: boolean;
  } = {},
) {
  let message = structuredClone(seed);
  if (options.unknown) {
    message.send_status = "UNKNOWN";
    message.allowed_actions = ["resolve"];
    message.attempts = [
      {
        attempt_id: boothId,
        attempt_no: 1,
        status: "UNKNOWN",
        provider_message_id: null,
        error_code: "TIMEOUT",
        started_at: seed.created_at,
        completed_at: seed.created_at,
      },
    ];
  }
  let conflict = options.conflict;
  const requests: {
    path: string;
    body: Record<string, unknown>;
    key: string;
  }[] = [];
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
  if (options.pending)
    await page.addInitScript(
      ({ actor, projectId, cid }) =>
        sessionStorage.setItem(
          `marketory:mutation:${actor}:communications:${projectId}`,
          JSON.stringify({
            key: cid,
            operation: "communications.send",
            path: `communications/${cid}/send`,
            method: "POST",
          }),
        ),
      { actor, projectId, cid },
    );
  await page.route("**/api/backend/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me"))
      return route.fulfill({
        json: {
          data: { user_id: actor, account_role: "STAFF", global_role: "USER" },
        },
      });
    if (options.denied)
      return route.fulfill({ status: 403, json: { code: "FORBIDDEN" } });
    if (path.includes("/me/requests/"))
      return route.fulfill({
        json: {
          data: {
            ...message,
            send_status: "QUEUED",
            allowed_actions: ["revise"],
          },
        },
      });
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      requests.push({
        path,
        body,
        key: route.request().headers()["idempotency-key"],
      });
      if (conflict) {
        conflict = false;
        message.version++;
        message.subject = "다른 운영자가 수정한 제목";
        return route.fulfill({
          status: 409,
          json: { code: "VERSION_CONFLICT" },
        });
      }
      message.version++;
      if (path.endsWith("/generate")) message = structuredClone(seed);
      if (path.endsWith("/revise")) {
        message.subject = body.subject;
        message.body = body.body;
        message.content_version++;
      }
      if (path.endsWith("/approve")) {
        message.send_status = "READY";
        message.approved_version = message.content_version;
        message.allowed_actions = ["revise", "send"];
      }
      if (path.endsWith("/send") || path.endsWith("/retry")) {
        message.send_status = "QUEUED";
        message.allowed_actions = ["revise"];
      }
      if (path.endsWith("/resolve")) {
        message.send_status =
          body.outcome === "ACCEPTED"
            ? "SENT"
            : body.outcome === "NOT_ACCEPTED"
              ? "FAILED"
              : "UNKNOWN";
        message.resolutions.push({
          resolution_id: cid,
          attempt_id: boothId,
          outcome: body.outcome,
          evidence_ref: body.evidence_ref,
          reason: body.reason,
          resolved_at: seed.created_at,
          resolved_by: actor,
        });
      }
      if (options.lost) return route.abort();
      return route.fulfill({
        status: path.endsWith("/send") ? 202 : 200,
        json: { data: message },
      });
    }
    if (path.endsWith("/communication-targets"))
      return route.fulfill({
        json: {
          data: {
            items: options.empty
              ? []
              : [
                  {
                    application_id: applicationId,
                    shop_name: "흙빛 공방",
                    status: "CONFIRMED",
                    notification_email: "seller@example.test",
                    has_booth: true,
                  },
                ],
            project: { project_id: projectId, name: "가을 숲길 마켓" },
          },
        },
      });
    if (path.endsWith(`/communications/${cid}`))
      return route.fulfill({ json: { data: message } });
    if (path.endsWith("/communications"))
      return route.fulfill({
        json: {
          data: {
            items: options.empty ? [] : [message],
            total: options.empty ? 0 : 1,
            limit: 20,
            offset: 0,
            project: { project_id: projectId, name: "가을 숲길 마켓" },
            delivery_enabled: false,
          },
        },
      });
    return route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
  });
  return requests;
}
async function openDetail(page: Page) {
  await page.goto(base);
  await page.getByRole("button", { name: /상세 보기/ }).click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
    seed.subject,
  );
}
test("approval and queue are separate confirmations; disabled delivery remains visible", async ({
  page,
}) => {
  const requests = await setup(page);
  await openDetail(page);
  await expect(page.getByText("실제 이메일 발송이 꺼져 있어요.")).toBeVisible();
  await page.getByLabel("처리 사유", { exact: true }).fill("내용 검토 완료");
  await page.getByRole("button", { name: "내용 승인", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "승인은 발송하지 않습니다",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "내용 승인", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "발송 요청", exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByLabel("처리 사유", { exact: true }).fill("운영 안내 발송");
  await page.getByRole("button", { name: "발송 요청", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "발송 요청", exact: true })
    .click();
  await expect(
    page.getByText("발송 대기", { exact: true }).first(),
  ).toBeVisible();
  expect(requests.map((r) => r.path.split("/").at(-1))).toEqual([
    "approve",
    "send",
  ]);
});
test("version conflict retains inputs and uses reviewed latest version", async ({
  page,
}) => {
  const requests = await setup(page, { conflict: true });
  await openDetail(page);
  await page.getByLabel("제목", { exact: true }).fill("내가 작성한 제목");
  await page.getByLabel("처리 사유", { exact: true }).fill("부스 수정");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await page
    .getByRole("button", { name: "최신 상태 확인", exact: true })
    .click();
  await expect(
    page.getByText("다른 운영자가 수정한 제목", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
    "내가 작성한 제목",
  );
  await page
    .getByRole("button", { name: "내 입력을 유지하고 최신 기준으로 검토" })
    .click();
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].body.expected_version).toBe(2);
  expect(requests[1].body.subject).toBe("내가 작성한 제목");
});
test("UNKNOWN requires evidence and never offers retry", async ({ page }) => {
  const requests = await setup(page, { unknown: true });
  await openDetail(page);
  await expect(
    page.getByRole("button", { name: "같은 내용 재시도", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("처리 사유", { exact: true }).fill("제공사 기록 확인");
  await page.getByRole("button", { name: "근거로 결과 기록" }).click();
  await expect(page.getByLabel("확인 근거", { exact: true })).toBeFocused();
  await page
    .getByLabel("확인 근거", { exact: true })
    .fill("provider-log-123 / 2026-10-12 10:00 KST");
  await page.getByRole("button", { name: "근거로 결과 기록" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "결과 기록", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].body).toMatchObject({
    attempt_id: boothId,
    method: "MANUAL_EVIDENCE",
    outcome: "INCONCLUSIVE",
  });
});
test("reopening UNKNOWN resets the outcome while latest-state review preserves it", async ({
  page,
}) => {
  const requests = await setup(page, { unknown: true });
  await openDetail(page);
  await page.getByLabel("확인 결과", { exact: true }).selectOption("ACCEPTED");
  await page
    .getByRole("button", { name: "최신 상태 확인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "내 입력을 유지하고 최신 기준으로 검토" })
    .click();
  await expect(page.getByLabel("확인 결과", { exact: true })).toHaveValue(
    "ACCEPTED",
  );
  await page.getByRole("button", { name: "새 안내 초안", exact: true }).click();
  await expect(page.getByLabel("안내할 셀러", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /상세 보기/ }).click();
  await expect(page.getByLabel("확인 결과", { exact: true })).toHaveValue(
    "INCONCLUSIVE",
  );
  expect(requests).toHaveLength(0);
});
test("reload pending marker only looks up the original operation", async ({
  page,
}) => {
  const requests = await setup(page, { pending: true });
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "새 안내 초안" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "기존 요청 다시 확인" })
    .first()
    .click();
  await expect(
    page.getByText("발송 대기", { exact: true }).first(),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
});
test("denied and empty states do not expose editable recipient data", async ({
  page,
}) => {
  await setup(page, { denied: true });
  await page.goto(base);
  await expect(page.getByText(/셀러 안내를 조회할 수 없어요/)).toBeVisible();
  await expect(
    page.getByText(seed.recipient_snapshot, { exact: true }),
  ).toHaveCount(0);
});
test("responsive editor preserves keyboard dialog and captures screenshots", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openDetail(page);
  await page.screenshot({
    path: "../../output/communications-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("처리 사유", { exact: true }).fill("검토");
  await page.getByRole("button", { name: "내용 승인", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "돌아가기" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "내용 승인", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../output/communications-mobile.png",
    fullPage: true,
  });
});

test("empty target list prevents creating an invalid draft", async ({
  page,
}) => {
  await setup(page, { empty: true });
  await page.goto(base);
  await expect(page.getByText("안내할 수 있는 신청이 없어요.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "템플릿 초안 만들기" }),
  ).toBeDisabled();
});
test("template creation uses an eligible target and no arbitrary recipient", async ({
  page,
}) => {
  const requests = await setup(page);
  await page.goto(base);
  await page
    .getByLabel("안내할 셀러", { exact: true })
    .selectOption(applicationId);
  await page.getByLabel("안내 종류", { exact: true }).selectOption("BOOTH");
  await page.getByLabel("처리 사유", { exact: true }).fill("부스 안내 초안");
  await page.getByRole("button", { name: "템플릿 초안 만들기" }).click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
    seed.subject,
  );
  expect(requests[0].body).toEqual({
    project_id: projectId,
    application_id: applicationId,
    type: "BOOTH",
    reason: "부스 안내 초안",
  });
});
