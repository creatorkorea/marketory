import { describe, expect, it, vi } from "vitest";
import {
  profilePayload,
  applicationPayload,
  validateSubmit,
  validateFiles,
  internalReturn,
  trustedUploadUrl,
  type Application,
  type UploadPolicy,
} from "../lib/seller/form";
import { recover } from "../lib/requests/recovery";
const projectId = "22222222-2222-4222-8222-222222222222";
const app = {
  application_id: "application",
  version: 4,
  status: "DRAFT",
  allowed_actions: ["update", "submit"],
  product_name: "컵",
  product_desc: "직접 구운 컵",
  price_range: "2만 원",
  category: "공예",
  attachments: [],
  project: {
    policy_json: {
      allowed_categories: ["공예"],
      photo_required: false,
      business_required: false,
    },
  },
} as unknown as Application;
const policy: UploadPolicy = {
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
const data = (values: Record<string, string>) => {
  const f = new FormData();
  Object.entries(values).forEach(([k, v]) => f.set(k, v));
  return f;
};
describe("seller forms and bounded uploads", () => {
  it("sends bearer bytes only to the exact configured API origin", () => {
    expect(
      trustedUploadUrl(
        "http://127.0.0.1:8000/api/attachments/uploads/id",
        "http://127.0.0.1:8000",
      ),
    ).toContain("/api/attachments");
    expect(() =>
      trustedUploadUrl(
        "https://attacker.test/upload",
        "https://api.example.test",
      ),
    ).toThrow("허용되지");
    expect(() =>
      trustedUploadUrl(
        "http://api.example.test/upload",
        "http://api.example.test",
      ),
    ).toThrow("허용되지");
    expect(() =>
      trustedUploadUrl("https://api.example.test/upload", undefined),
    ).toThrow("주소를 확인");
  });
  it("accepts only explicit internal project return destinations", () => {
    expect(internalReturn(`/p/${projectId}/apply`)).toBe(
      `/p/${projectId}/apply`,
    );
    for (const path of [
      "https://example.com",
      `//example.com/p/${projectId}/apply`,
      `/p/${projectId}/apply?token=secret`,
      `/p/${projectId}/../account`,
    ])
      expect(internalReturn(path)).toBeUndefined();
  });
  it("normalizes optional profile fields without inventing data", () => {
    const result = profilePayload(
      data({
        name: "이름",
        shop_name: "가게",
        owner_name: "대표자",
        phone: "010-1234-5678",
      }),
    );
    expect(result.business_no).toBeNull();
    expect(result.base_product_desc).toBeNull();
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("account_role");
  });
  it("rejects unsafe SNS and focuses a named validation field", () => {
    expect(() =>
      profilePayload(
        data({
          name: "이름",
          shop_name: "가게",
          owner_name: "대표자",
          phone: "010-1234-5678",
          sns_url: "javascript:alert(1)",
        }),
      ),
    ).toThrow("http 또는 https");
  });
  it("NEED_INFO sends only requested content and latest version", () => {
    const body = applicationPayload(
      data({
        product_name: "수정",
        product_desc: "무단 변경",
        table_count: "3",
      }),
      {
        ...app,
        status: "NEED_INFO",
        info_requests_json: [{ field: "product_name", reason: "자세히" }],
      },
    );
    expect(body).toEqual({ expected_version: 4, product_name: "수정" });
  });
  it("rejects fractional table requirements before save", () => {
    expect(() => applicationPayload(data({ table_count: "1.5" }), app)).toThrow(
      "정수",
    );
  });
  it("validates required PRODUCT_IMAGE and BUSINESS_DOC metadata", () => {
    const required = {
      ...app,
      project: {
        ...app.project,
        policy_json: {
          ...app.project.policy_json,
          photo_required: true,
          business_required: true,
        },
      },
    };
    expect(() => validateSubmit(required)).toThrow("상품 사진");
    const image = {
      attachment_id: "a",
      file_type: "PRODUCT_IMAGE",
      original_name: "a.png",
      mime_type: "image/png",
      size_bytes: 12,
    };
    expect(() => validateSubmit({ ...required, attachments: [image] })).toThrow(
      "사업자 증빙",
    );
    expect(() =>
      validateSubmit({
        ...required,
        attachments: [image, { ...image, file_type: "BUSINESS_DOC" }],
      }),
    ).not.toThrow();
  });
  it("enforces policy counts, MIME and 10MiB before issuing any request", () => {
    expect(() =>
      validateFiles(
        [{ name: "x", size: 10485761, type: "image/png" }],
        "product_images",
        policy,
        0,
      ),
    ).toThrow("크기");
    expect(() =>
      validateFiles(
        [{ name: "x", size: 10, type: "image/svg+xml" }],
        "product_images",
        policy,
        0,
      ),
    ).toThrow("형식");
    expect(() =>
      validateFiles(
        [{ name: "x", size: 10, type: "image/png" }],
        "product_images",
        policy,
        10,
      ),
    ).toThrow("최대 10");
    expect(() =>
      validateFiles(
        [{ name: "x", size: 10, type: "application/pdf" }],
        "business_document",
        policy,
        1,
      ),
    ).toThrow("최대 1");
  });
  it.each([401, 409])(
    "never re-executes a seller write after %s",
    async (status) => {
      const execute = vi
          .fn()
          .mockResolvedValue({ status, body: { code: "BLOCKED" } }),
        lookup = vi.fn();
      await recover({ execute, lookup, signal: new AbortController().signal });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(lookup).not.toHaveBeenCalled();
    },
  );
  it("response loss returns the committed original result without a duplicate", async () => {
    const execute = vi.fn().mockRejectedValue(new TypeError("lost")),
      lookup = vi
        .fn()
        .mockResolvedValue({
          status: 200,
          body: {
            outcome: "SUCCEEDED",
            http_status: 201,
            response: { data: { application_id: "same" } },
          },
        });
    const result = await recover({
      execute,
      lookup,
      sleep: async () => {},
      signal: new AbortController().signal,
    });
    expect(result.body?.data).toEqual({ application_id: "same" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
