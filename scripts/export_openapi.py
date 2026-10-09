import json
from pathlib import Path

from marketory.config import Settings
from marketory.main import create_app

root = Path(__file__).resolve().parents[1]
schema = create_app(Settings(environment="test", database_url=None)).openapi()
target = root / "packages/types/openapi.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(
    json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
