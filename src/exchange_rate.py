"""
exchange_rate.py

Fetches exchange rate middle prices from 中国人民银行外汇交易中心.
Caches results locally.
"""

import json
import logging
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import requests
from dateutil import parser as date_parser

logger = logging.getLogger(__name__)

# chinamoney API endpoint for exchange rates
CHINAMONEY_URL = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew"

# Map of currency codes to their Chinese names used in the API
CURRENCY_MAP = {
    "USD": "美元",
    "HKD": "港元",
    "EUR": "欧元",
    "GBP": "英镑",
    "JPY": "日元",
    "SGD": "新加坡元",
    "AUD": "澳大利亚元",
    "CAD": "加拿大元",
    "CHF": "瑞士法郎",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.chinamoney.com.cn/chinese/bkccpr/",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def _get_first_workday(year: int, month: int) -> date:
    """Return the first calendar day of the month (will shift to workday if needed during fetch)."""
    return date(year, month, 1)


def _is_workday(d: date) -> bool:
    """Simple check: Mon-Fri. Does not account for Chinese public holidays."""
    return d.weekday() < 5


def _next_workday(d: date) -> date:
    """Return the next workday on or after d."""
    while not _is_workday(d):
        d += timedelta(days=1)
    return d


def _cache_path(cache_dir: Path, year: int, month: int) -> Path:
    return cache_dir / f"rates_{year:04d}_{month:02d}.json"


def _load_cache(cache_dir: Path, year: int, month: int) -> Optional[dict]:
    path = _cache_path(cache_dir, year, month)
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load cache {path}: {e}")
    return None


def _save_cache(cache_dir: Path, year: int, month: int, data: dict) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = _cache_path(cache_dir, year, month)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info(f"Cached exchange rates to {path}")


def _fetch_rates_for_date(query_date: date, currencies: list[str]) -> Optional[dict[str, float]]:
    """
    Fetch exchange rate middle prices from chinamoney for a specific date.
    Returns dict of {currency_code: rate} or None on failure.
    """
    date_str = query_date.strftime("%Y-%m-%d")
    params = {
        "startDate": date_str,
        "endDate": date_str,
        "currency": "",  # empty means all
    }

    try:
        resp = requests.post(CHINAMONEY_URL, data=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"HTTP request failed for {date_str}: {e}")
        return None
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error for {date_str}: {e}")
        return None

    records = data.get("records", []) or data.get("data", {}).get("records", [])
    if not records:
        # Try alternate JSON structure
        if "data" in data and isinstance(data["data"], list):
            records = data["data"]

    if not records:
        logger.warning(f"No rate records returned for {date_str}")
        return None

    rates: dict[str, float] = {}
    for record in records:
        # Fields: voName (currency name), voCod (currency code), middlePri (middle price), etc.
        code = record.get("voCod", "").upper().strip()
        middle = record.get("middlePri") or record.get("middle") or record.get("middlePrice")
        if not middle:
            continue
        try:
            rate_val = float(str(middle).replace(",", ""))
            if code in currencies:
                rates[code] = rate_val
        except (ValueError, TypeError):
            continue

    return rates if rates else None


def _fetch_rates_fallback(query_date: date, currencies: list[str]) -> dict[str, float]:
    """
    Fallback: try alternate API format.
    """
    date_str = query_date.strftime("%Y-%m-%d")
    url2 = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHis"
    params = {
        "startDate": date_str,
        "endDate": date_str,
        "currency": "USD",
        "pageNum": 1,
        "pageSize": 20,
    }
    try:
        resp = requests.post(url2, data=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        records = data.get("records", [])
        rates: dict[str, float] = {}
        for record in records:
            code = record.get("voCod", "").upper().strip()
            middle = record.get("middlePri")
            if code and middle:
                try:
                    rates[code] = float(str(middle).replace(",", ""))
                except (ValueError, TypeError):
                    pass
        return rates
    except Exception as e:
        logger.error(f"Fallback fetch failed: {e}")
        return {}


def get_exchange_rates(config: dict, year: int, month: int) -> dict[str, float]:
    """
    Get exchange rate middle prices for the first workday of the given year/month.

    Returns dict mapping currency code -> rate (CNY per 1 unit of foreign currency,
    or CNY per 100 units for JPY).

    Falls back to hardcoded approximate rates if network unavailable.
    """
    ref_cfg = config.get("exchange_rate", {})
    cache_dir = Path(ref_cfg.get("cache_dir", "./data/exchange_rate_cache/"))
    currencies = [c.upper() for c in ref_cfg.get("currencies", list(CURRENCY_MAP.keys()))]

    # Check cache
    cached = _load_cache(cache_dir, year, month)
    if cached:
        logger.info(f"Loaded exchange rates from cache for {year}-{month:02d}")
        return cached.get("rates", {})

    # Try to fetch from chinamoney
    start_date = _get_first_workday(year, month)
    target_date = _next_workday(start_date)

    rates: dict[str, float] = {}
    max_attempts = 10  # try up to 10 days forward
    for attempt in range(max_attempts):
        current = target_date + timedelta(days=attempt)
        if current.month != month:
            break
        logger.info(f"Fetching exchange rates for {current} (attempt {attempt+1})")
        fetched = _fetch_rates_for_date(current, currencies)
        if fetched:
            rates = fetched
            break
        logger.warning(f"No rates for {current}, trying next day...")

    if not rates:
        logger.warning("chinamoney fetch failed. Trying fallback...")
        rates = _fetch_rates_fallback(target_date, currencies)

    if not rates:
        logger.warning("All fetches failed. Using approximate hardcoded rates.")
        rates = _get_hardcoded_rates()

    # Filter to requested currencies only
    rates = {k: v for k, v in rates.items() if k in currencies}

    # Cache the result
    cache_data = {
        "year": year,
        "month": month,
        "fetch_date": str(target_date),
        "source": "chinamoney",
        "rates": rates,
    }
    _save_cache(cache_dir, year, month, cache_data)

    return rates


def _get_hardcoded_rates() -> dict[str, float]:
    """
    Approximate rates as fallback (CNY per 1 unit, except JPY per 100).
    These are rough estimates and should not be used for production.
    """
    return {
        "USD": 7.28,
        "HKD": 0.934,
        "EUR": 7.84,
        "GBP": 9.18,
        "JPY": 4.82,   # per 100 JPY
        "SGD": 5.38,
        "AUD": 4.72,
        "CAD": 5.28,
        "CHF": 8.12,
    }


def convert_to_cny(amount: float, currency: str, rates: dict[str, float]) -> tuple[float, float]:
    """
    Convert an amount in foreign currency to CNY.

    For JPY, the rate from PBOC is per 100 JPY.

    Returns (cny_amount, rate_used).
    """
    currency = currency.upper()
    if currency == "CNY" or currency == "RMB":
        return round(amount, 2), 1.0

    rate = rates.get(currency)
    if rate is None:
        logger.warning(f"No rate found for {currency}. Cannot convert.")
        return amount, 1.0

    # JPY rate from PBOC is per 100 units
    if currency == "JPY":
        cny = amount * rate / 100
    else:
        cny = amount * rate

    return round(cny, 2), rate


def format_rates_summary(rates: dict[str, float]) -> str:
    """Format exchange rates for terminal display."""
    lines = ["[Step 1] 汇率获取结果（中国人民银行中间价）:"]
    for code, rate in sorted(rates.items()):
        if code == "JPY":
            lines.append(f"  {code}: {rate} CNY / 100 JPY")
        else:
            lines.append(f"  {code}: {rate} CNY / 1 {code}")
    return "\n".join(lines)
