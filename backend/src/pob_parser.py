"""Local strict regex parser and physical validator for LINE POB messages."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

TAIWAN_TZ = timezone(timedelta(hours=8))

_FULLWIDTH_TRANS = str.maketrans(
    {
        "０": "0",
        "１": "1",
        "２": "2",
        "３": "3",
        "４": "4",
        "５": "5",
        "６": "6",
        "７": "7",
        "８": "8",
        "９": "9",
        "／": "/",
        "：": ":",
        "（": "(",
        "）": ")",
        "．": ".",
        "－": "-",
        "\r": " ",
        "\n": " ",
        "\t": " ",
        "\xa0": " ",
        "\u3000": " ",
    }
)

_HEADER_RE = re.compile(
    r"(?:台中廠|臺中廠)\s*:?\s*(?:LNG\s*船\s*)?(?P<ship>.+?)\s*已於\s*(?P<rest>.+)",
    re.IGNORECASE,
)

_YEAR_DATE_RE = re.compile(
    r"^(?P<y>\d{3,4})\s*(?:[/.\-]|年)\s*(?P<m>\d{1,2})\s*(?:[/.\-]|月)\s*(?P<d>\d{1,2})日?"
)

_MD_DATE_RE = re.compile(
    r"^(?P<m>\d{1,2})\s*(?:[/.\-]|月)\s*(?P<d>\d{1,2})日?"
)

_WEEKDAY_RE = re.compile(
    r"^(?:\(\s*(?:(?:週|星期)?[一二三四五六日天]|[A-Za-z]{3})\s*\)|(?:週|星期)[一二三四五六日天])\s*"
)

_TIME_COLON_RE = re.compile(
    r"^(?P<h>\d{1,2})\s*:\s*(?P<m>\d{2})\s*POB(?![A-Z0-9])",
    re.IGNORECASE,
)

_TIME_CJK_RE = re.compile(
    r"^(?P<h>\d{1,2})\s*[點時]\s*(?P<m>\d{2})\s*分?\s*POB(?![A-Z0-9])",
    re.IGNORECASE,
)

_TIME_COMPACT_RE = re.compile(
    r"^(?P<h>\d{2})(?P<m>\d{2})\s*POB(?![A-Z0-9])",
    re.IGNORECASE,
)

_SHIP_INVALID_PUNCT_RE = re.compile(r"[。？！.?!]")
_SHIP_HAS_NAME_CHAR_RE = re.compile(r"[A-Za-z\u4e00-\u9fff]")


def resolve_event_taiwan_dt(
    event_timestamp_ms: int | float | None = None,
    now: datetime | None = None,
) -> datetime:
    """Convert LINE millisecond timestamp to Asia/Taipei, falling back to now."""
    if (
        isinstance(event_timestamp_ms, (int, float))
        and not isinstance(event_timestamp_ms, bool)
        and event_timestamp_ms >= 0
    ):
        return datetime.fromtimestamp(event_timestamp_ms / 1000.0, tz=TAIWAN_TZ)

    if now is not None:
        return now.astimezone(TAIWAN_TZ) if now.tzinfo else now.replace(tzinfo=TAIWAN_TZ)

    return datetime.now(TAIWAN_TZ)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.translate(_FULLWIDTH_TRANS)).strip()


def _clean_ship_name(raw_ship: str) -> str | None:
    cleaned = raw_ship.strip(" \t「」『』\"\"''()（）【】[]")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned or "已於" in cleaned or _SHIP_INVALID_PUNCT_RE.search(cleaned):
        return None
    if not _SHIP_HAS_NAME_CHAR_RE.search(cleaned):
        return None
    return cleaned


def _consume_optional_date(rest: str, event_date: date) -> tuple[date | None, bool, str]:
    """Consume an optional leading date and weekday; return (date, had_explicit_date, remaining)."""
    year_match = _YEAR_DATE_RE.match(rest)
    if year_match:
        y_str = year_match.group("y")
        year = int(y_str) + 1911 if len(y_str) == 3 else int(y_str)
        month = int(year_match.group("m"))
        day = int(year_match.group("d"))
        match_end = year_match.end()
    else:
        md_match = _MD_DATE_RE.match(rest)
        if not md_match:
            return event_date, False, rest
        year = event_date.year
        month = int(md_match.group("m"))
        day = int(md_match.group("d"))
        match_end = md_match.end()

    try:
        parsed_date = date(year, month, day)
    except ValueError:
        return None, True, ""

    remaining = rest[match_end:].lstrip()
    weekday_match = _WEEKDAY_RE.match(remaining)
    if weekday_match:
        remaining = remaining[weekday_match.end():].lstrip()
    return parsed_date, True, remaining


def _parse_time_and_pob(rest: str) -> str | None:
    for pattern in (_TIME_COLON_RE, _TIME_CJK_RE, _TIME_COMPACT_RE):
        match = pattern.match(rest)
        if match:
            hour = int(match.group("h"))
            minute = int(match.group("m"))
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                return f"{hour:02d}:{minute:02d}"
            return None
    return None


def parse_pob_message(
    user_msg: str,
    event_timestamp_ms: int | float | None = None,
    now: datetime | None = None,
) -> dict[str, str] | None:
    """Parse a standard Taichung LNG POB message and enforce date/time invariants."""
    if not isinstance(user_msg, str) or not user_msg.strip():
        return None

    normalized = _normalize_text(user_msg)
    header_match = _HEADER_RE.search(normalized)
    if not header_match:
        return None

    ship_name = _clean_ship_name(header_match.group("ship"))
    if not ship_name:
        return None

    event_dt = resolve_event_taiwan_dt(event_timestamp_ms=event_timestamp_ms, now=now)
    parsed_date, had_explicit_date, remaining = _consume_optional_date(
        header_match.group("rest").lstrip(),
        event_dt.date(),
    )
    if parsed_date is None or parsed_date != event_dt.date():
        return None

    pob_time = _parse_time_and_pob(remaining)
    if not pob_time:
        return None

    if not ("04:00" <= pob_time <= "17:00"):
        return None

    if pob_time > event_dt.strftime("%H:%M"):
        return None

    return {
        "ship_name": ship_name,
        "date": parsed_date.isoformat(),
        "time": pob_time,
        "date_source": "message" if had_explicit_date else "event",
    }
