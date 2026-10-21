import { test, expect } from "@playwright/test";

const pid = "22222222-2222-4222-8222-222222222222";
const market = {
  project_id: pid, name: "초록 공예 마켓", venue: "성수 작은 광장",
  event_date: "2027-11-10", recruit_end_at: "2027-11-01T09:00:00Z",
  allowed_categories: ["공예", "도자기"], participation_fee_krw: 15000,
};

test("home opens public recruitment and exposes apply destination without login", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/backend/public/projects?*", r => r.fulfill({ json: { data: [market], has_more: false } }));
  await page.route(`**/api/backend/public/projects/${pid}`, r => r.fulfill({ json: { data: {
    ...market, status: "RECRUITING", accepting_applications: true,
    recruit_start_at: "2026-10-01T00:00:00Z", event_end_at: "2027-11-10T09:00:00Z",
    policy_json: { ...market, restricted_items: [], photo_required: true, business_required: false },
    booth_policy_json: { description: "테이블 제공" },
  } } }));
  await page.goto("/");
  await page.getByRole("link", { name: "모집 마켓 보기", exact: true }).click();
  await expect(page).toHaveURL(/#recruiting$/);
  await expect(page.getByRole("heading", { name: market.name })).toBeVisible();
  await expect(page.getByText("15,000원", { exact: true })).toBeVisible();
  await expect(page.getByText("2027. 11. 01. 오후 06:00", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const detail = page.getByRole("link", { name: `${market.name} 모집 안내 보기` });
  await detail.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/p/${pid}`);
  await expect(page.getByRole("link", { name: "마켓 신청하기" })).toHaveAttribute("href", `/p/${pid}/apply`);
  await page.getByRole("link", { name: "모집 마켓 목록으로" }).click();
  await expect(page).toHaveURL(/\/#recruiting$/);
  await expect(page.getByRole("heading", { name: market.name })).toBeVisible();
  await page.screenshot({ path: "../../output/home-recruiting-mobile.png", fullPage: true, style: "nextjs-portal { display: none; }" });
});

test("home separates loading, failure retry and empty recruitment", async ({ page }) => {
  let fail = true;
  await page.route("**/api/backend/public/projects?*", async r => {
    await new Promise(resolve => setTimeout(resolve, 600));
    await r.fulfill(fail ? { status: 503, json: { code: "API_UNAVAILABLE" } } : { json: { data: [], has_more: false } });
  });
  await page.goto("/");
  await expect(page.getByText("모집 중인 마켓을 불러오고 있어요.", { exact: true })).toBeVisible();
  await expect(page.getByText("모집 정보를 불러오지 못했어요.", { exact: true })).toBeVisible();
  await expect(page.getByText("지금은 모집 중인 마켓이 없어요.")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "다시 확인" }).click();
  await expect(page.getByText("지금은 모집 중인 마켓이 없어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "내 신청 확인", exact: true })).toBeVisible();
});

test("load more preserves cards on failure and avoids duplicate entries", async ({ page }) => {
  let fail = true;
  await page.route("**/api/backend/public/projects?*", r => {
    if (new URL(r.request().url()).searchParams.get("offset") === "0")
      return r.fulfill({ json: { data: [market], has_more: true } });
    return r.fulfill(fail ? { status: 503, json: {} } : { json: { data: [market, { ...market, project_id: "33333333-3333-4333-8333-333333333333", name: "두 번째 마켓" }], has_more: false } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "마켓 더 보기" }).click();
  await expect(page.getByText("모집 정보를 불러오지 못했어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: market.name })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "다시 확인" }).click();
  await expect(page.getByRole("heading", { name: "두 번째 마켓" })).toBeVisible();
  await expect(page.getByRole("heading", { name: market.name })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "마켓 더 보기" })).toHaveCount(0);
});

test("long recruitment content remains usable on desktop and narrow screens", async ({ page }) => {
  const longName = "함께 만드는 이야기와 정성이 가득한 작은 가게들의 가을 공예 마켓";
  await page.route("**/api/backend/public/projects?*", r => r.fulfill({ json: {
    data: [market, { ...market, project_id: "33333333-3333-4333-8333-333333333333", name: longName,
      venue: "서울특별시 성동구 성수동 오래된 창고 안쪽의 작은 광장과 연결된 야외 공간", participation_fee_krw: 0 }], has_more: false,
  } }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: longName })).toBeVisible();
  await page.screenshot({ path: "../../output/home-recruiting-desktop.png", fullPage: true, style: "nextjs-portal { display: none; }" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("heading", { name: longName })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: `${longName} 모집 안내 보기` }).focus();
  await expect(page.getByRole("link", { name: `${longName} 모집 안내 보기` })).toBeFocused();
});
