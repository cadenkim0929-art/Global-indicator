#!/usr/bin/env python3
"""Translate EP Industry Monitor articles.

Writes titleKo/summaryKo or titleEn/summaryEn fields directly into data/articles.json and
keeps a translation cache at data/translation-cache.json to avoid repeated requests.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

try:
    from deep_translator import GoogleTranslator
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "deep-translator is not installed. Run: .venv-translate/bin/pip install deep-translator"
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
ARTICLES_PATH = ROOT / "data" / "articles.json"
CACHE_PATH = ROOT / "data" / "translation-cache.json"


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def trim(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    return text[:limit]


def translate_text(translator: GoogleTranslator, cache: dict[str, str], text: str, *, limit: int) -> str:
    text = trim(text, limit)
    if not text:
        return ""
    if text in cache:
        return cache[text]
    translated = translator.translate(text)
    cache[text] = translated
    return translated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=30, help="max articles to translate")
    parser.add_argument("--sleep", type=float, default=0.25, help="delay between articles")
    parser.add_argument("--force", action="store_true", help="overwrite existing translated fields")
    parser.add_argument("--target", choices=["ko", "en"], default="ko", help="translation target language")
    parser.add_argument("--only-nonlatin-title-en", action="store_true", help="for --target en, only translate missing/non-Latin titleEn")
    parser.add_argument("--include-summary-en", action="store_true", help="for --target en, also fill missing/non-Latin summaryEn")
    args = parser.parse_args()

    articles = load_json(ARTICLES_PATH, [])
    cache = load_json(CACHE_PATH, {})
    translator = GoogleTranslator(source="auto", target=args.target)

    translated_count = 0
    errors: list[dict[str, str]] = []

    for article in articles:
        if translated_count >= args.limit:
            break
        if args.target == "ko":
            needs_title = args.force or not article.get("titleKo")
            needs_summary = args.force or not article.get("summaryKo")
        else:
            title_en = article.get("titleEn", "") or ""
            summary_en = article.get("summaryEn", "") or ""
            has_nonlatin_title_en = bool(re.search(r"[가-힣ぁ-ヿ一-龯]", title_en))
            has_nonlatin_summary_en = bool(re.search(r"[가-힣ぁ-ヿ一-龯]", summary_en))
            needs_title = args.force or not title_en or has_nonlatin_title_en
            needs_summary = args.include_summary_en and (args.force or not summary_en or has_nonlatin_summary_en)
            if args.only_nonlatin_title_en and title_en and not has_nonlatin_title_en:
                needs_title = False
        if not (needs_title or needs_summary):
            continue
        try:
            if args.target == "ko":
                if needs_title:
                    article["titleKo"] = translate_text(translator, cache, article.get("title", ""), limit=450)
                if needs_summary:
                    article["summaryKo"] = translate_text(translator, cache, article.get("summary", ""), limit=900)
                preview = article.get("titleKo", "")
            else:
                if needs_title:
                    article["titleEn"] = translate_text(translator, cache, article.get("title", ""), limit=450).replace('[매크로]', '[Macro]')
                if needs_summary:
                    article["summaryEn"] = translate_text(translator, cache, article.get("summary", ""), limit=900).replace('[매크로]', '[Macro]')
                preview = article.get("titleEn", "")
            translated_count += 1
            print(f"translated {translated_count}: {article.get('feedName')} / {preview[:60]}")
            if args.sleep:
                time.sleep(args.sleep)
        except Exception as exc:
            errors.append({"id": article.get("id", ""), "title": article.get("title", ""), "error": str(exc)})
            print(f"ERROR {article.get('id')}: {exc}")

    save_json(ARTICLES_PATH, articles)
    save_json(CACHE_PATH, cache)

    result: dict[str, Any] = {"translated": translated_count, "errors": len(errors), "cacheSize": len(cache)}
    if errors:
        result["errorSamples"] = errors[:5]
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
