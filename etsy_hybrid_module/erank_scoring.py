import csv
import io
import math
import re
import unicodedata


MIN_SEARCH_VOLUME = 21
HIGH_COMPETITION_LIMIT = 100000


def normalize_keyword(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def keyword_key(value) -> str:
    return unicodedata.normalize("NFKC", normalize_keyword(value)).casefold()


def _first_value(row: dict, aliases: tuple, default=""):
    for alias in aliases:
        if alias in row and str(row[alias]).strip() != "":
            return row[alias]
    return default


def parse_number(value, default=0.0) -> float:
    text = str(value or "").strip()
    if not text:
        return default
    text = text.replace("%", "").replace("<", "").replace(">", "").replace(" ", "")
    text = text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return default
    try:
        return float(match.group(0))
    except ValueError:
        return default


def calculate_keyword_score(
    searches: int,
    competition: int,
    clicks=None,
    ctr=None,
    trend=None,
    word_count: int = 1,
) -> float:
    """
    Return a 0-100 opportunity score. Search volume and competition always
    participate; clicks, CTR and trend are included only when the CSV supplies them.
    """
    searches = max(int(searches or 0), 0)
    competition = max(int(competition or 0), 0)

    volume_ratio = min(math.log1p(searches) / math.log1p(5000), 1.0)
    competition_ratio = 1.0 - min(math.log1p(competition) / math.log1p(500000), 1.0)

    earned = (volume_ratio * 40.0) + (competition_ratio * 35.0)
    available = 75.0

    # Long-tail phrases carry clearer buyer intent than single generic words.
    earned += 5.0 if word_count >= 3 else (3.0 if word_count == 2 else 0.0)
    available += 5.0

    if clicks is not None:
        click_ratio = min(max(float(clicks), 0.0) / max(searches, 1), 1.5) / 1.5
        earned += click_ratio * 10.0
        available += 10.0

    if ctr is not None:
        ctr_ratio = min(max(float(ctr), 0.0), 150.0) / 150.0
        earned += ctr_ratio * 10.0
        available += 10.0

    if trend is not None:
        # Positive change can add up to five points; negative change removes up to five.
        trend_ratio = max(-100.0, min(float(trend), 100.0)) / 100.0
        earned += trend_ratio * 5.0
        available += 5.0

    return round(max(0.0, min((earned / available) * 100.0, 100.0)), 2)


def normalize_stored_score(record: dict) -> float:
    """Convert legacy boosted scores to the current 0-100 scale for display."""
    raw_score = parse_number(record.get("score"), default=-1.0)
    if 0.0 <= raw_score <= 100.0:
        return round(raw_score, 2)
    keyword = normalize_keyword(record.get("keyword"))
    return calculate_keyword_score(
        int(parse_number(record.get("searches"))),
        int(parse_number(record.get("competition"))),
        word_count=len(keyword.split()),
    )


def clean_erank_records(records: list) -> list:
    """
    Hide obsolete low-volume rows and collapse duplicate concept+keyword rows.
    Input is expected newest-first; the first occurrence is retained.
    """
    cleaned = []
    seen = set()
    for raw_item in records or []:
        item = dict(raw_item)
        keyword = normalize_keyword(item.get("keyword"))
        searches = int(parse_number(item.get("searches")))
        if not keyword or len(keyword.split()) < 2 or searches < MIN_SEARCH_VOLUME:
            continue
        dedupe_key = (keyword_key(item.get("concept")), keyword_key(keyword))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        item["keyword"] = keyword
        item["searches"] = searches
        item["competition"] = int(parse_number(item.get("competition")))
        item["score"] = normalize_stored_score(item)
        cleaned.append(item)
    return cleaned


def parse_erank_csv(csv_content: str, concept: str):
    csv_content = str(csv_content or "").encode("utf-8").decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(csv_content))
    if reader.fieldnames:
        reader.fieldnames = [str(name).strip().lower() for name in reader.fieldnames if name]

    stats = {
        "added": 0,
        "updated": 0,
        "rejected_single_word": 0,
        "rejected_low_search": 0,
        "high_competition": 0,
        "duplicates_collapsed": 0,
        "with_clicks": 0,
        "with_ctr": 0,
        "with_trend": 0,
    }
    latest_by_keyword = {}

    for row in reader:
        safe_row = {
            str(key).strip().lower(): str(value).strip() if value is not None else ""
            for key, value in row.items()
            if key is not None
        }
        keyword = normalize_keyword(_first_value(safe_row, ("keywords", "keyword", "tag")))
        if not keyword:
            continue
        if len(keyword.split()) < 2:
            stats["rejected_single_word"] += 1
            continue

        searches = int(parse_number(_first_value(
            safe_row, ("average searches", "avg searches", "search volume", "searches")
        )))
        competition = int(parse_number(_first_value(
            safe_row, ("etsy competition", "competition")
        )))
        if searches < MIN_SEARCH_VOLUME:
            stats["rejected_low_search"] += 1
            continue

        clicks_raw = _first_value(safe_row, ("average clicks", "avg clicks", "clicks"), None)
        ctr_raw = _first_value(
            safe_row, ("average ctr", "avg ctr", "ctr", "click through rate", "click-through rate"), None
        )
        trend_raw = _first_value(safe_row, ("trend change", "trend", "change"), None)
        clicks = parse_number(clicks_raw) if clicks_raw is not None else None
        ctr = parse_number(ctr_raw) if ctr_raw is not None else None
        trend = parse_number(trend_raw) if trend_raw is not None else None

        key = keyword_key(keyword)
        if key in latest_by_keyword:
            stats["duplicates_collapsed"] += 1
        latest_by_keyword[key] = {
            "concept": normalize_keyword(concept),
            "keyword": keyword,
            "score": calculate_keyword_score(
                searches,
                competition,
                clicks=clicks,
                ctr=ctr,
                trend=trend,
                word_count=len(keyword.split()),
            ),
            "searches": searches,
            "competition": competition,
        }

        if clicks is not None:
            stats["with_clicks"] += 1
        if ctr is not None:
            stats["with_ctr"] += 1
        if trend is not None:
            stats["with_trend"] += 1

    records = list(latest_by_keyword.values())
    records.sort(key=lambda item: item["score"], reverse=True)
    stats["added"] = len(records)
    stats["high_competition"] = sum(
        1 for item in records if item["competition"] > HIGH_COMPETITION_LIMIT
    )
    return records, stats, reader.fieldnames or []
