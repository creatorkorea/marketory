from io import BytesIO

import httpx
import pytest
from PIL import Image
from pypdf import PdfWriter

from marketory.config import Settings
from marketory.errors import DomainError
from marketory.runtime import run_async
from marketory.storage import MAX_BYTES, Storage, inspect_file


def png():
    data = BytesIO()
    Image.new("RGB", (3, 3), "green").save(data, format="PNG")
    return data.getvalue()


def test_file_validation_checks_bytes_not_labels():
    assert inspect_file(png(), "image/png", "product_images") == "image/png"
    for content, mime, field in [
        (b"<script>bad</script>", "image/png", "product_images"),
        (png(), "image/jpeg", "product_images"),
        (b"%PDF-1.7\ntest\n%%EOF", "application/pdf", "product_images"),
        (b"%PDF-1.7\nnot a PDF\n%%EOF", "application/pdf", "business_document"),
        (b"x" * (MAX_BYTES + 1), "image/png", "product_images"),
    ]:
        with pytest.raises(DomainError):
            inspect_file(content, mime, field)
    pdf = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(pdf)
    assert inspect_file(pdf.getvalue(), "application/pdf", "business_document") == "application/pdf"


def test_storage_is_private_no_upsert_and_errors_are_redacted():
    requests = []

    def handle(request):
        requests.append(request)
        if request.url.path.endswith("/bucket/seller-assets"):
            return httpx.Response(200, json={"public": False})
        if request.url.path.endswith("/sign/seller-assets/test.png"):
            return httpx.Response(
                200, json={"signedURL": "/object/sign/seller-assets/test.png?token=test"}
            )
        if request.method == "POST":
            return httpx.Response(200, json={"Key": "seller-assets/test.png"})
        return httpx.Response(200, content=png(), headers={"content-type": "image/png"})

    async def scenario():
        storage = Storage(
            Settings(
                supabase_url="https://storage.example.test", supabase_secret_key="server-only"
            ),
            transport=httpx.MockTransport(handle),
        )
        await storage.upload("test.png", png(), "image/png")
        assert next(r for r in requests if r.method == "POST").headers["x-upsert"] == "false"
        assert await storage.read("test.png") == png()
        url = await storage.signed_url("test.png")
        assert url.startswith("https://storage.example.test/storage/v1/object/sign/")
        missing = Storage(Settings(supabase_secret_key=None))
        with pytest.raises(DomainError) as e:
            await missing.read("test.png")
        assert e.value.code == "STORAGE_UNAVAILABLE"

    run_async(scenario())


def test_public_bucket_is_rejected_before_upload():
    async def scenario():
        storage = Storage(
            Settings(supabase_url="https://storage.example.test", supabase_secret_key="secret"),
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"public": True})),
        )
        with pytest.raises(DomainError) as e:
            await storage.upload("test.png", png(), "image/png")
        assert e.value.code == "STORAGE_UNAVAILABLE"

    run_async(scenario())
