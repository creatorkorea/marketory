"""Private Storage adapter; provider credentials never reach application responses."""

import warnings
from io import BytesIO
from urllib.parse import quote

import httpx
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from marketory.errors import DomainError

MAX_BYTES = 10 * 1024 * 1024
IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"]
POLICY = {
    "max_size_bytes": MAX_BYTES,
    "max_product_images": 10,
    "max_business_documents": 1,
    "product_image_mime_types": IMAGE_MIMES,
    "business_document_mime_types": [*IMAGE_MIMES, "application/pdf"],
}


def inspect_file(content: bytes, declared_mime: str, field: str) -> str:
    if not content or len(content) > MAX_BYTES:
        raise DomainError(422, "INVALID_FILE_SIZE", "파일은 0바이트 초과, 10 MiB 이하여야 합니다.")
    if declared_mime == "application/pdf" and field == "business_document":
        try:
            if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-1024:]:
                raise ValueError("Invalid PDF signature")
            reader = PdfReader(BytesIO(content), strict=True)
            if reader.is_encrypted or not 1 <= len(reader.pages) <= 100:
                raise ValueError("Unsupported PDF")
            for page in reader.pages:
                _ = page.mediabox
            return "application/pdf"
        except (PyPdfError, ValueError, KeyError, TypeError, OSError, RecursionError):
            raise DomainError(
                422, "INVALID_FILE", "암호가 없는 정상 PDF(100쪽 이하)를 선택해 주세요."
            ) from None
    if declared_mime not in IMAGE_MIMES:
        raise DomainError(422, "INVALID_FILE_TYPE", "JPG·PNG·WebP 사진을 선택해 주세요.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                actual = Image.MIME.get(image.format)
                if actual != declared_mime or image.width * image.height > 40000000:
                    raise ValueError("Unsupported image")
                image.verify()
            with Image.open(BytesIO(content)) as image:
                image.load()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise DomainError(
            422, "INVALID_FILE", "손상되지 않은 JPG·PNG·WebP 사진을 선택해 주세요."
        ) from None
    return declared_mime


class Storage:
    def __init__(self, settings, transport=None):
        self.settings, self.transport = settings, transport

    def configured(self):
        if not self.settings.supabase_url or not self.settings.supabase_secret_key:
            raise DomainError(503, "STORAGE_UNAVAILABLE", "파일 저장소 연결이 필요합니다.")

    def target(self, prefix, key):
        self.configured()
        if not key or ".." in key.split("/") or key.startswith("/"):
            raise DomainError(422, "INVALID_STORAGE_KEY", "파일 경로를 확인해 주세요.")
        return (
            self.settings.supabase_url.rstrip("/")
            + "/storage/v1/"
            + prefix
            + "/"
            + quote(self.settings.storage_bucket, safe="")
            + "/"
            + quote(key, safe="/")
        )

    def headers(self):
        secret = self.settings.supabase_secret_key.get_secret_value()
        return {"apikey": secret, "Authorization": "Bearer " + secret}

    async def ensure_private(self):
        self.configured()
        try:
            async with httpx.AsyncClient(
                timeout=10, transport=self.transport, follow_redirects=False
            ) as client:
                response = await client.get(
                    self.settings.supabase_url.rstrip("/")
                    + "/storage/v1/bucket/"
                    + quote(self.settings.storage_bucket, safe=""),
                    headers=self.headers(),
                )
            if response.status_code != 200 or response.json().get("public") is not False:
                raise ValueError("Private bucket required")
        except (httpx.HTTPError, ValueError, TypeError):
            raise DomainError(
                503, "STORAGE_UNAVAILABLE", "비공개 파일 저장소 설정을 확인해 주세요."
            ) from None

    async def upload(self, key, content, mime):
        await self.ensure_private()
        url = self.target("object", key)
        try:
            async with httpx.AsyncClient(
                timeout=30, transport=self.transport, follow_redirects=False
            ) as client:
                r = await client.post(
                    url,
                    content=content,
                    headers={**self.headers(), "Content-Type": mime, "x-upsert": "false"},
                )
        except httpx.HTTPError:
            raise DomainError(
                503,
                "STORAGE_UNAVAILABLE",
                "업로드 결과를 확인하지 못했습니다. 같은 파일로 다시 확인해 주세요.",
            ) from None
        if r.status_code not in (200, 201):
            raise DomainError(503, "STORAGE_UNAVAILABLE", "파일 저장을 확인하지 못했습니다.")

    async def read(self, key):
        await self.ensure_private()
        url = self.target("object/authenticated", key)
        try:
            async with httpx.AsyncClient(
                timeout=30, transport=self.transport, follow_redirects=False
            ) as client:
                async with client.stream("GET", url, headers=self.headers()) as r:
                    # Storage may encode missing object as 400 rather than HTTP 404.
                    if r.status_code in (400, 404):
                        raise DomainError(
                            404, "FILE_NOT_UPLOADED", "먼저 파일 전송을 완료해 주세요."
                        )
                    if r.status_code != 200:
                        raise DomainError(503, "STORAGE_UNAVAILABLE", "파일을 확인하지 못했습니다.")
                    chunks, size = [], 0
                    async for chunk in r.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise DomainError(
                                422, "INVALID_FILE_SIZE", "파일 크기 제한을 초과했습니다."
                            )
                        chunks.append(chunk)
                    return b"".join(chunks)
        except httpx.HTTPError:
            raise DomainError(503, "STORAGE_UNAVAILABLE", "파일을 확인하지 못했습니다.") from None

    async def signed_url(self, key):
        await self.ensure_private()
        url = self.target("object/sign", key)
        try:
            async with httpx.AsyncClient(
                timeout=10, transport=self.transport, follow_redirects=False
            ) as client:
                r = await client.post(url, json={"expiresIn": 300}, headers=self.headers())
            if r.status_code != 200:
                raise ValueError("Provider rejected")
            signed = r.json()["signedURL"]
            expected = "/object/sign/" + self.settings.storage_bucket + "/" + key + "?"
            if not isinstance(signed, str) or not signed.startswith(expected):
                raise ValueError("Unexpected signed URL")
            return self.settings.supabase_url.rstrip("/") + "/storage/v1" + signed
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise DomainError(
                503, "STORAGE_UNAVAILABLE", "파일 보기 주소를 발급하지 못했습니다."
            ) from None
