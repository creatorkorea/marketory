import { test, expect, type Page } from "@playwright/test";
import type { Application } from "../../lib/seller/form";
const actor = "11111111-1111-4111-8111-111111111111",
  pid = "22222222-2222-4222-8222-222222222222",
  aid = "33333333-3333-4333-8333-333333333333";
const user = {
  id: actor,
  email: "seller@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-10-09T00:00:00Z",
};
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })).toString("base64url")}.signature`;
const project = {
  project_id: pid,
  name: "테스트 공예 마켓",
  venue: "테스트 광장",
  event_date: "2027-11-10",
  recruit_start_at: "2026-10-01T00:00:00Z",
  recruit_end_at: "2027-11-01T09:00:00Z",
  event_end_at: "2027-11-10T09:00:00Z",
  status: "RECRUITING",
  accepting_applications: true,
  policy_version: 1,
  policy_json: {
    allowed_categories: ["공예"],
    restricted_items: [],
    photo_required: false,
    business_required: false,
    participation_fee_krw: 0,
    consent_version: "test-v1",
    consent_text: "테스트용 정책 본문",
  },
  booth_policy_json: { description: "테스트용 운영 안내" },
};
const profile = {
  seller_id: "seller",
  user_id: actor,
  name: "테스트 셀러",
  shop_name: "테스트 가게",
  owner_name: "테스트 대표자",
  phone: "01012345678",
  business_no: null,
  sns_url: null,
  base_category: "공예",
  base_product_desc: "공예 상품",
  version: 1,
};
const seed = {
  application_id: aid,
  project_id: pid,
  status: "DRAFT",
  version: 1,
  revision_no: 1,
  product_name: "테스트 컵",
  product_desc: "테스트 소개",
  price_range: "2만 원",
  category: "공예",
  electricity_required: false,
  table_count: 0,
  fire_required: false,
  cold_storage_required: false,
  vehicle_entry_required: false,
  request_note: "",
  project,
  attachments: [] as {
    attachment_id: string;
    file_type: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
  }[],
  allowed_actions: ["update", "upload", "detach", "submit", "cancel"],
};
const policy = {
  upload_origin: "http://127.0.0.1:3000",
  max_size_bytes: 10485760,
  max_product_images: 10,
  max_business_documents: 1,
  product_image_mime_types: ["image/jpeg", "image/png", "image/webp"],
  business_document_mime_types: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ],
};
test("seller published notices show safe text, retry and pagination on mobile", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await fixture(page);
  await page.route(`**/api/backend/applications/${aid}`, route => route.fulfill({json:{data:{...seed,status:"CONFIRMED",allowed_actions:[]}}}));
  let fail = true;
  await page.route(`**/api/backend/applications/${aid}/notices**`, route => {
    if (fail) return route.fulfill({status:503,json:{code:"UNAVAILABLE"}});
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    return route.fulfill({json:{data:{items:[{communication_id: String(offset), subject: offset ? "이전 안내" : "행사 준비 안내", body: "<script>실행하지 않음</script>\n준비물: 가격표\n" + "긴안내".repeat(80), content_version:1, published_at:"2026-10-21T13:00:00Z"}],limit:5,offset,has_more:offset===0}}});
  });
  await page.goto(`/me/applications/${aid}`);
  const region = page.getByRole("region",{name:"운영 안내",exact:true});
  await expect(region.getByText("운영 안내를 불러오지 못했어요.")).toBeVisible();
  fail = false;
  await region.getByRole("button",{name:"다시 불러오기"}).click();
  await expect(region.getByRole("heading",{name:"행사 준비 안내"})).toBeVisible();
  await expect(region.getByText(/<script>실행하지 않음/)).toBeVisible();
  await region.getByRole("button",{name:"다음 안내"}).click();
  await expect(region.getByRole("heading",{name:"이전 안내"})).toBeVisible();
  await expect(region.getByRole("heading",{name:"행사 준비 안내"})).toHaveCount(0);
  await region.getByRole("button",{name:"이전 안내"}).click();
  await expect(region.getByRole("heading",{name:"행사 준비 안내"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:"../../output/publication-seller-mobile.png",fullPage:true});
});
test("seller sees confirmed booth details and pending placement distinctly", async ({
  page,
}) => {
  await fixture(page);
  let assigned = true;
  await page.route(`**/api/backend/applications/${aid}`, (route) =>
    route.fulfill({
      json: {
        data: {
          ...seed,
          status: "CONFIRMED",
          allowed_actions: ["cancel"],
          booth: assigned
            ? {
                booth_id: "44444444-4444-4444-8444-444444444444",
                booth_no: "A01",
                zone: "중앙",
                electricity_available: true,
                fire_allowed: false,
                cold_storage_available: false,
                vehicle_access: true,
                table_capacity: 2,
                confirmed_at: "2026-10-09T01:00:00Z",
              }
            : null,
        },
      },
    }),
  );
  await page.goto(`/me/applications/${aid}`);
  await expect(
    page.getByText("확정 부스 · A01", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("구역: 중앙", { exact: true })).toBeVisible();
  assigned = false;
  await page.reload();
  await expect(
    page.getByText("부스 배치를 기다리고 있어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("확정 부스 · A01", { exact: true })).toHaveCount(
    0,
  );
});
async function auth(page: Page) {
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
async function fixture(page: Page) {
  await auth(page);
  await page.route("**/api/backend/me", (r) =>
    r.fulfill({ json: { data: { user_id: actor, account_role: "SELLER" } } }),
  );
  await page.route("**/api/backend/me/seller", (r) =>
    r.fulfill({ json: { data: profile } }),
  );
  await page.route("**/api/backend/public/projects/*", (r) =>
    r.fulfill({ json: { data: project } }),
  );
  await page.route("**/api/backend/attachments/policy", (r) =>
    r.fulfill({ json: { data: policy } }),
  );
  await page.route("**/api/backend/me/applications?*", (r) =>
    r.fulfill({ json: { data: [seed] } }),
  );
}
test("public market and authenticated profile keep narrow keyboard layout", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/p/${pid}`);
  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
  await page.getByRole("link", { name: "마켓 신청하기" }).focus();
  await expect(page.getByRole("link", { name: "마켓 신청하기" })).toBeFocused();
  await page.goto("/seller/profile");
  await expect(page.getByLabel("이름 (필수)")).toHaveValue(profile.name);
  await page.getByLabel("이름 (필수)").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("상호 (필수)")).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../../output/seller-profile-desktop.png",
    fullPage: true,
  });
});
test("seller UX keeps uploads before next and cancellation deliberately collapsed", async ({
  page,
}) => {
  await fixture(page);
  await page.route(`**/api/backend/applications/${aid}`, (r) =>
    r.fulfill({ json: { data: seed } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${pid}/apply`);
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  const upload = await page.getByLabel("상품 사진 선택").boundingBox();
  const next = await page
    .getByRole("button", { name: "다음 단계" })
    .boundingBox();
  expect(upload!.y + upload!.height).toBeLessThan(next!.y);
  await expect(page.getByLabel("취소 사유")).toBeHidden();
  await page.locator(".seller-cancel summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("취소 사유")).toBeVisible();
  await page.getByLabel("취소 사유").fill("테스트 취소 확인");
  await page.getByRole("button", { name: "신청 취소 내용 확인" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".seller-cancel summary").focus();
  await page.keyboard.press("Enter");
  await page.screenshot({
    path: "../../output/ux-audit-20261019/01-seller-after.png",
    fullPage: true,
  });
});

test("mobile confirmation retains selected facilities and long notes", async ({ page }) => {
  await fixture(page);
  await page.route(`**/api/backend/applications/${aid}`, r => r.fulfill({ json: { data: {
    ...seed, electricity_required: true, cold_storage_required: true, table_count: 2,
    request_note: "긴 요청 사항도 생략 없이 확인할 수 있어야 합니다. ".repeat(8),
  } } }));
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/p/${pid}/apply`);
    await page.getByRole("button", { name: "2. 상품과 사진" }).click();
    expect((await page.getByLabel("상품명 (필수)").boundingBox())!.y).toBeLessThan(600);
    await page.getByRole("button", { name: "4. 동의 및 확인" }).click();
    await expect(page.getByText("전기 필요 · 냉장 보관 필요 · 테이블 2개", { exact: true })).toBeVisible();
    await expect(page.getByText("테스트용 정책 본문", { exact: true })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /긴 요청 사항도 생략 없이/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("wizard saves, reviews server consent, and prevents duplicate submit", async ({
  page,
}) => {
  await fixture(page);
  let app = structuredClone(seed),
    submitted = 0;
  await page.route(`**/api/backend/applications/${aid}`, (r) => {
    if (r.request().method() === "PATCH") {
      const body = r.request().postDataJSON();
      expect(body.expected_version).toBe(app.version);
      app = {
        ...app,
        ...body,
        version: app.version + 1,
        revision_no: app.revision_no + 1,
      };
    }
    return r.fulfill({ json: { data: app } });
  });
  await page.route(`**/api/backend/applications/${aid}/submit`, (r) => {
    submitted++;
    expect(r.request().postDataJSON()).toMatchObject({
      expected_version: app.version,
      expected_policy_version: 1,
      consent_version: "test-v1",
      consent_accepted: true,
    });
    return r.fulfill({
      json: {
        data: {
          ...app,
          status: "SUBMITTED",
          submitted_at: "2026-10-09T07:00:00Z",
          allowed_actions: ["cancel"],
        },
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${pid}/apply`);
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  await page.getByLabel("상품명 (필수)").fill("수정한 컵");
  await expect(
    page.getByRole("status").filter({ hasText: "임시저장됨" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../output/seller-application-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "4. 동의 및 확인" }).click();
  await expect(page.getByText("추가 시설 요청 없음 · 테이블 0개", { exact: true })).toBeVisible();
  await expect(
    page.getByText("테스트용 정책 본문", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("위 동의 내용을 확인하고 동의합니다.").check();
  await page.screenshot({
    path: "../../output/ux-audit-20261019/05-seller-confirmation.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "신청 제출 내용 확인" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "돌아가기", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "신청 제출하기", exact: true })
    .click();
  await expect(page.getByText("접수 완료", { exact: true })).toBeVisible();
  await expect(page.getByText("신청이 접수되었습니다. 이후 결과는 내 신청에서 확인해 주세요.", { exact: true })).toBeVisible();
  await expect(page.getByText("저장된 초안에서 이어서 준비할 수 있어요.", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "../../output/ux-audit-20261019/06-seller-submitted.png",
    fullPage: true,
  });
  expect(submitted).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("stale version preserves input and requires latest comparison", async ({
  page,
}) => {
  await fixture(page);
  await page.route(`**/api/backend/applications/${aid}`, (r) =>
    r.request().method() === "PATCH"
      ? r.fulfill({ status: 409, json: { code: "VERSION_CONFLICT" } })
      : r.fulfill({
          json: { data: { ...seed, version: 3, product_name: "다른 탭의 컵" } },
        }),
  );
  await page.goto(`/me/applications/${aid}`);
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  await page.getByLabel("상품명 (필수)").fill("보존할 입력");
  await expect(
    page.getByText("다른 변경이 있어 저장을 멈췄어요."),
  ).toBeVisible();
  await expect(page.getByLabel("상품명 (필수)")).toHaveValue("보존할 입력");
  await page.getByRole("button", { name: "최신 신청 확인" }).click();
  await expect(page.getByText(/최신 상태:.*다른 탭의 컵/)).toBeVisible();
  await expect(page.getByLabel("상품명 (필수)")).toHaveValue("보존할 입력");
});
test("lost save response and 401 reuse original request rather than another write", async ({
  page,
}) => {
  await fixture(page);
  let writes = 0;
  let key = "";
  await page.route(`**/api/backend/applications/${aid}`, (r) => {
    if (r.request().method() === "PATCH") {
      writes++;
      key = r.request().headers()["idempotency-key"];
      return r.abort("failed");
    }
    return r.fulfill({ json: { data: seed } });
  });
  await page.route("**/api/backend/me/requests/applications.update/*", (r) => {
    expect(r.request().url()).toContain(key);
    return r.fulfill({
      json: {
        outcome: "SUCCEEDED",
        http_status: 200,
        response: {
          data: { ...seed, product_name: "응답 복구 컵", version: 2 },
        },
      },
    });
  });
  await page.goto(`/me/applications/${aid}`);
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  await page.getByLabel("상품명 (필수)").fill("응답 복구 컵");
  await expect(page.getByText("임시저장됨", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  expect(writes).toBe(1);
  await page.unroute(`**/api/backend/applications/${aid}`);
  await page.route(`**/api/backend/applications/${aid}`, (r) =>
    r.fulfill({ status: 401, json: { code: "UNAUTHENTICATED" } }),
  );
  await page.getByLabel("상품명 (필수)").fill("재인증 후 보존");
  await expect(page.getByText("다시 로그인이 필요해요.")).toBeVisible();
  await expect(page.getByLabel("상품명 (필수)")).toHaveValue("재인증 후 보존");
  await expect(page.getByLabel("상품명 (필수)")).toBeDisabled();
});
test("two files issue transfer and complete sequentially with fresh versions", async ({
  page,
}) => {
  await fixture(page);
  let app = structuredClone(seed),
    count = 0;
  const order: string[] = [];
  await page.route(`**/api/backend/applications/${aid}`, (r) =>
    r.fulfill({ json: { data: app } }),
  );
  await page.route("**/api/backend/attachments/upload-url", (r) => {
    const b = r.request().postDataJSON();
    expect(b.expected_version).toBe(app.version);
    expect(b.expected_revision_no).toBe(app.revision_no);
    count++;
    order.push(`issue${count}`);
    return r.fulfill({
      json: {
        data: {
          upload_intent_id: `intent-${count}`,
          upload_url: `http://127.0.0.1:3000/test-upload-${count}`,
          application_version: app.version,
          revision_no: app.revision_no,
        },
      },
    });
  });
  await page.route("**/test-upload-*", (r) => {
    order.push(`put${count}`);
    expect(r.request().headers().authorization).toContain("Bearer ");
    return r.fulfill({ status: 200, json: { data: {} } });
  });
  await page.route("**/api/backend/attachments/complete", (r) => {
    order.push(`complete${count}`);
    expect(r.request().postDataJSON().expected_version).toBe(app.version);
    app = {
      ...app,
      version: app.version + 1,
      revision_no: app.revision_no + 1,
      attachments: [
        ...app.attachments,
        {
          attachment_id: `file-${count}`,
          file_type: "PRODUCT_IMAGE",
          original_name: `photo-${count}.png`,
          mime_type: "image/png",
          size_bytes: 10,
        },
      ],
    };
    return r.fulfill({
      json: {
        data: {
          attachment_id: `file-${count}`,
          application_version: app.version,
          revision_no: app.revision_no,
        },
      },
    });
  });
  await page.goto(`/me/applications/${aid}`);
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  await page.getByLabel("상품 사진 선택").setInputFiles([
    {
      name: "one.png",
      mimeType: "image/png",
      buffer: Buffer.from("mock bytes"),
    },
    {
      name: "two.png",
      mimeType: "image/png",
      buffer: Buffer.from("mock bytes"),
    },
  ]);
  await expect(
    page.getByRole("listitem").filter({ hasText: "photo-2.png" }),
  ).toContainText("연결 완료");
  expect(order).toEqual([
    "issue1",
    "put1",
    "complete1",
    "issue2",
    "put2",
    "complete2",
  ]);
});

test("server pending files block submit after local storage loss and can be abandoned", async ({
  page,
}) => {
  await fixture(page);
  let app = {
    ...structuredClone(seed),
    pending_uploads: [
      {
        upload_intent_id: "55555555-5555-4555-8555-555555555555",
        application_version: 1,
        revision_no: 1,
        original_name: "끊긴 전송.png",
        field_code: "product_images",
        expires_at: "2026-10-09T08:00:00Z",
      },
    ],
  };
  let abandoned = 0;
  await page.route(`**/api/backend/applications/${aid}`, (r) =>
    r.fulfill({ json: { data: app } }),
  );
  await page.route("**/api/backend/attachments/uploads/*/abandon", (r) => {
    abandoned++;
    expect(r.request().postDataJSON().expected_version).toBe(app.version);
    app = { ...app, pending_uploads: [] };
    return r.fulfill({
      json: {
        data: {
          application_version: app.version,
          revision_no: app.revision_no,
        },
      },
    });
  });
  await page.goto(`/me/applications/${aid}`);
  await page.getByRole("button", { name: "4. 동의 및 확인" }).click();
  await expect(
    page.getByRole("button", { name: "신청 제출 내용 확인" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  await expect(page.getByText("끊긴 전송.png · 미완료 업로드")).toBeVisible();
  await page.getByRole("button", { name: "미완료 선택 해제" }).click();
  await expect(page.getByLabel("상품 사진 선택")).toBeEnabled();
  expect(abandoned).toBe(1);
});

test("NEED_INFO shows deadline and sends only requested fields", async ({
  page,
}) => {
  await fixture(page);
  let app: Application = {
    ...structuredClone(seed),
    status: "NEED_INFO",
    allowed_actions: ["update", "resubmit", "cancel"],
    info_due_at: "2027-10-09T09:00:00Z",
    info_requests_json: [
      { field: "product_desc", reason: "재료를 알려 주세요." },
    ],
  };
  let patch: Record<string, unknown> | undefined;
  await page.route(`**/api/backend/applications/${aid}`, (r) => {
    if (r.request().method() === "PATCH") {
      patch = r.request().postDataJSON();
      app = { ...app, ...patch, version: app.version + 1 };
    }
    return r.fulfill({ json: { data: app } });
  });
  await page.goto(`/me/applications/${aid}`);
  await expect(page.getByText(/보완기한 \(한국시간\)/)).toBeVisible();
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  await expect(page.getByLabel("상품명 (필수)")).toBeDisabled();
  await expect(page.getByLabel("상품 소개 (필수)")).toBeEnabled();
  await expect(page.getByLabel("상품 사진 선택")).toBeDisabled();
  await page.getByLabel("상품 소개 (필수)").fill("테스트 재료 소개");
  await expect(page.getByText("임시저장됨", { exact: true })).toBeVisible();
  expect(patch).toEqual({
    expected_version: 1,
    product_desc: "테스트 재료 소개",
  });
});

test("upload conflict refresh synchronizes clean fields before any later save", async ({
  page,
}) => {
  await fixture(page);
  let app: Application = structuredClone(seed);
  let saved: Record<string, unknown> | undefined;
  const intentId = "55555555-5555-4555-8555-555555555555";
  await page.route(`**/api/backend/applications/${aid}`, (r) => {
    if (r.request().method() === "PATCH") {
      saved = r.request().postDataJSON();
      app = { ...app, ...saved, version: app.version + 1 };
    }
    return r.fulfill({ json: { data: app } });
  });
  await page.route("**/api/backend/attachments/upload-url", (r) => {
    app = {
      ...app,
      pending_uploads: [
        {
          upload_intent_id: intentId,
          application_version: 1,
          revision_no: 1,
          original_name: "photo.png",
          field_code: "product_images",
          expires_at: "2027-10-09T09:00:00Z",
        },
      ],
    };
    return r.fulfill({
      json: {
        data: {
          upload_intent_id: intentId,
          application_version: 1,
          revision_no: 1,
          upload_url: "http://127.0.0.1:3000/test-upload-conflict",
        },
      },
    });
  });
  await page.route("**/test-upload-conflict", (r) =>
    r.fulfill({ status: 200, json: { data: {} } }),
  );
  await page.route("**/api/backend/attachments/complete", (r) => {
    app = {
      ...app,
      product_desc: "다른 탭에서 변경한 소개",
      version: 7,
      revision_no: 7,
    };
    return r.fulfill({ status: 409, json: { code: "VERSION_CONFLICT" } });
  });
  await page.route("**/api/backend/attachments/uploads/*/abandon", (r) => {
    expect(r.request().postDataJSON().expected_version).toBe(7);
    app = { ...app, pending_uploads: [] };
    return r.fulfill({
      json: { data: { application_version: 7, revision_no: 7 } },
    });
  });
  await page.goto(`/me/applications/${aid}`);
  await page.getByRole("button", { name: "2. 상품과 사진" }).click();
  await page.getByLabel("상품 사진 선택").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("mock bytes"),
  });
  await expect(
    page.getByText("다른 변경이 있어 저장을 멈췄어요."),
  ).toBeVisible();
  await page.getByRole("button", { name: "최신 파일 확인" }).click();
  await expect(page.getByLabel("상품 소개 (필수)")).toHaveValue(
    "다른 탭에서 변경한 소개",
  );
  await page.getByRole("button", { name: "미완료 선택 해제" }).click();
  await expect(page.getByLabel("상품명 (필수)")).toBeEnabled();
  await page.getByLabel("상품명 (필수)").fill("새 상품명");
  await expect(page.getByText("임시저장됨", { exact: true })).toBeVisible();
  expect(saved?.expected_version).toBe(7);
  expect(saved?.product_desc).toBe("다른 탭에서 변경한 소개");
});

test("approved seller explicitly confirms participation and expired deadline stays approved", async ({
  page,
}) => {
  await fixture(page);
  let app = {
    ...structuredClone(seed),
    status: "APPROVED",
    confirm_due_at: "2027-11-05T09:00:00Z",
    allowed_actions: ["confirm", "cancel"],
  };
  let calls = 0;
  await page.route(`**/api/backend/applications/${aid}`, (r) =>
    r.fulfill({ json: { data: app } }),
  );
  await page.route(`**/api/backend/applications/${aid}/confirm`, async (r) => {
    calls++;
    expect(r.request().postDataJSON()).toEqual({ expected_version: 1 });
    app = {
      ...app,
      version: 2,
      status: "CONFIRMED",
      allowed_actions: ["cancel"],
    };
    await r.fulfill({ json: { data: app } });
  });
  await page.goto(`/me/applications/${aid}`);
  await page.getByRole("button", { name: "참가확정 내용 확인" }).click();
  await expect(page.getByRole("dialog")).toContainText("참가를 확정할까요?");
  await page.getByRole("button", { name: "참가확정하기", exact: true }).click();
  await expect(page.getByText("참가확정이 완료됐어요.")).toBeVisible();
  expect(calls).toBe(1);
  app = {
    ...app,
    status: "APPROVED",
    confirm_due_at: "2020-01-01T00:00:00Z",
    allowed_actions: ["cancel"],
  };
  await page.reload();
  await expect(page.getByText("현재 참가확정할 수 없습니다.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "참가확정 내용 확인" }),
  ).toHaveCount(0);
  expect(calls).toBe(1);
});
