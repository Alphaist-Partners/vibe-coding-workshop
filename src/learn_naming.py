"""
learn_naming.py

Reads reference/sample_files/ filenames and learns naming patterns.
Outputs reference/learned_naming.json
"""

import json
import logging
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# Common date patterns in filenames
DATE_PATTERNS = [
    (r"\d{8}", "%Y%m%d"),           # 20250301
    (r"\d{4}-\d{2}-\d{2}", "%Y-%m-%d"),  # 2025-03-01
    (r"\d{4}/\d{2}/\d{2}", "%Y/%m/%d"),  # 2025/03/01
    (r"\d{4}\.\d{2}\.\d{2}", "%Y.%m.%d"),  # 2025.03.01
]

# Amount patterns
AMOUNT_PATTERNS = [
    r"\d+\.\d{2}",   # 1234.56
    r"\d+\.\d{1}",   # 1234.5
    r"\d{3,}",       # 1234 (plain integer amount)
]

# Currency codes
CURRENCY_CODES = ["CNY", "USD", "HKD", "EUR", "GBP", "JPY", "SGD", "AUD", "CAD", "CHF", "RMB"]

# Category keywords that might appear in filenames
CATEGORY_KEYWORDS = [
    "机票", "火车票", "高铁", "酒店", "住宿", "出租车", "网约车", "打车",
    "差旅", "餐饮", "午餐", "晚餐", "工作餐", "接待",
    "办公", "文具", "耗材", "软件",
    "通讯", "电话", "网络",
    "会议", "论坛", "培训",
    "咨询", "法务", "审计",
    "信用卡", "账单",
    "发票", "收据", "receipt",
]

SEPARATORS = ["_", "-", " ", "."]


def _detect_separator(filenames: list[str]) -> str:
    """Detect the most common separator in filenames."""
    counts = Counter()
    for fn in filenames:
        stem = Path(fn).stem
        for sep in SEPARATORS:
            counts[sep] += stem.count(sep)
    if not counts:
        return "_"
    return counts.most_common(1)[0][0]


def _extract_date_from_filename(stem: str) -> tuple[str | None, str | None]:
    """Try to extract a date from the filename stem. Returns (date_str, fmt)."""
    for pattern, fmt in DATE_PATTERNS:
        m = re.search(pattern, stem)
        if m:
            return m.group(), fmt
    return None, None


def _extract_amount_from_filename(stem: str) -> str | None:
    """Try to extract an amount from the filename stem."""
    for pattern in AMOUNT_PATTERNS:
        m = re.search(pattern, stem)
        if m:
            return m.group()
    return None


def _extract_currency_from_filename(stem: str) -> str | None:
    """Try to extract a currency code from the filename stem."""
    upper = stem.upper()
    for code in CURRENCY_CODES:
        if code in upper:
            return code
    return None


def _extract_category_from_filename(stem: str) -> str | None:
    """Try to extract a category keyword from the filename stem."""
    for kw in CATEGORY_KEYWORDS:
        if kw in stem:
            return kw
    return None


def _analyze_filename(filename: str) -> dict[str, Any]:
    """Analyze a single filename and extract its components."""
    stem = Path(filename).stem
    ext = Path(filename).suffix.lower()

    sep = _detect_separator([filename])
    parts = re.split(r"[_\-\s\.]+", stem)

    date_val, date_fmt = _extract_date_from_filename(stem)
    amount_val = _extract_amount_from_filename(stem)
    currency_val = _extract_currency_from_filename(stem)
    category_val = _extract_category_from_filename(stem)

    # Try to detect sequence number (usually last part, digits)
    seq_val = None
    if parts:
        last = parts[-1]
        if re.match(r"^\d{1,4}$", last):
            seq_val = last

    return {
        "filename": filename,
        "stem": stem,
        "extension": ext,
        "parts": parts,
        "detected_date": date_val,
        "date_format": date_fmt,
        "detected_amount": amount_val,
        "detected_currency": currency_val,
        "detected_category": category_val,
        "detected_seq": seq_val,
    }


def _infer_pattern(analyses: list[dict], separator: str) -> dict[str, Any]:
    """
    Infer naming pattern from analyzed filenames.
    Returns pattern dict.
    """
    has_date = sum(1 for a in analyses if a["detected_date"])
    has_amount = sum(1 for a in analyses if a["detected_amount"])
    has_currency = sum(1 for a in analyses if a["detected_currency"])
    has_category = sum(1 for a in analyses if a["detected_category"])
    has_seq = sum(1 for a in analyses if a["detected_seq"])

    total = len(analyses)

    # Date format: pick most common
    date_fmts = [a["date_format"] for a in analyses if a["date_format"]]
    date_fmt = "%Y%m%d"
    if date_fmts:
        date_fmt = Counter(date_fmts).most_common(1)[0][0]

    # Build pattern components
    pattern_parts = []
    if has_date / total > 0.5:
        pattern_parts.append("{date}")
    # Person name is hard to detect; include as optional
    pattern_parts.append("{person}")
    if has_category / total > 0.3:
        pattern_parts.append("{category_l2}")
    if has_amount / total > 0.3:
        pattern_parts.append("{amount}")
    if has_currency / total > 0.3:
        pattern_parts.append("{currency}")
    if has_seq / total > 0.3:
        pattern_parts.append("{seq}")

    if not pattern_parts:
        pattern_parts = ["{date}", "{person}", "{category_l2}", "{amount}", "{currency}", "{seq}"]

    pattern = separator.join(pattern_parts)

    # Detect decimal places from amounts
    amounts = [a["detected_amount"] for a in analyses if a["detected_amount"]]
    decimal_places = 2
    if amounts:
        decimal_counts = [len(amt.split(".")[-1]) if "." in amt else 0 for amt in amounts]
        decimal_places = Counter(decimal_counts).most_common(1)[0][0] if decimal_counts else 2

    return {
        "pattern": pattern,
        "separator": separator,
        "date_format": date_fmt,
        "amount_format": {
            "decimal_places": decimal_places,
            "thousands_separator": False,
        },
        "seq_format": "zero_padded_2",
        "extension": "preserve_original",
        "special_rules": {
            "credit_card_statement": "命名中使用'信用卡账单'而非单独费用类别"
        },
    }


def learn_naming(config: dict, force: bool = False) -> dict:
    """
    Main entry: read sample_files/ dir, infer naming convention.
    Returns learned_naming dict.
    """
    ref = config.get("reference", {})
    sample_files_dir = Path(ref.get("sample_files_dir", "./reference/sample_files/"))
    learned_naming_path = Path(ref.get("learned_naming", "./reference/learned_naming.json"))

    # Cache check
    if not force and learned_naming_path.exists():
        logger.info("Learned naming already exists. Loading from cache.")
        with open(learned_naming_path, encoding="utf-8") as f:
            return json.load(f)

    # Default result in case nothing can be learned
    default_naming = {
        "pattern": "{date}_{person}_{category_l2}_{amount}_{currency}_{seq}",
        "separator": "_",
        "date_format": "%Y%m%d",
        "amount_format": {
            "decimal_places": 2,
            "thousands_separator": False,
        },
        "seq_format": "zero_padded_2",
        "extension": "preserve_original",
        "special_rules": {
            "credit_card_statement": "命名中使用'信用卡账单'而非单独费用类别"
        },
        "examples_analyzed": 0,
        "confidence": "low",
        "notes": "No sample files found. Using default naming convention.",
    }

    if not sample_files_dir.exists():
        logger.warning(f"sample_files_dir not found: {sample_files_dir}")
        _save_naming(learned_naming_path, default_naming)
        return default_naming

    filenames = [
        f for f in os.listdir(str(sample_files_dir))
        if not f.startswith(".") and os.path.isfile(os.path.join(str(sample_files_dir), f))
    ]

    if not filenames:
        logger.warning("sample_files/ is empty. Using default naming.")
        _save_naming(learned_naming_path, default_naming)
        return default_naming

    logger.info(f"Analyzing {len(filenames)} sample filenames...")

    # Analyze each filename
    analyses = [_analyze_filename(fn) for fn in filenames]

    # Detect separator
    separator = _detect_separator(filenames)

    # Infer pattern
    pattern_info = _infer_pattern(analyses, separator)

    # Build final result
    result = {
        **pattern_info,
        "examples_analyzed": len(filenames),
        "confidence": "high" if len(filenames) >= 5 else "medium",
        "notes": f"从{len(filenames)}个样本文件中学习得出",
        "sample_filenames": filenames[:10],  # store up to 10 for reference
    }

    _save_naming(learned_naming_path, result)
    return result


def _save_naming(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info(f"Saved learned_naming.json to {path}")


def apply_naming_pattern(
    naming: dict,
    person: str,
    date: str,
    category_l2: str,
    amount: float | str,
    currency: str,
    seq: int,
    original_ext: str,
    doc_type: str = "",
) -> str:
    """
    Apply the learned naming pattern to generate a new filename.

    Args:
        naming: learned_naming dict
        person: reimbursement person name
        date: YYYY-MM-DD or YYYYMMDD string
        category_l2: second-level category
        amount: numeric or string amount
        currency: currency code
        seq: sequence number
        original_ext: original file extension (e.g. '.pdf')
        doc_type: document type string (used for credit card override)
    Returns:
        New filename string (without directory)
    """
    sep = naming.get("separator", "_")
    date_fmt = naming.get("date_format", "%Y%m%d")
    amount_fmt = naming.get("amount_format", {})
    seq_fmt = naming.get("seq_format", "zero_padded_2")
    pattern = naming.get("pattern", "{date}_{person}_{category_l2}_{amount}_{currency}_{seq}")
    special_rules = naming.get("special_rules", {})

    # Format date
    from datetime import datetime
    try:
        if isinstance(date, str) and len(date) == 8 and date.isdigit():
            dt = datetime.strptime(date, "%Y%m%d")
        elif isinstance(date, str) and "-" in date:
            dt = datetime.strptime(date[:10], "%Y-%m-%d")
        else:
            dt = datetime.now()
        date_str = dt.strftime(date_fmt)
    except Exception:
        date_str = str(date)

    # Format amount
    decimal_places = amount_fmt.get("decimal_places", 2)
    try:
        amount_str = f"{float(amount):.{decimal_places}f}"
    except Exception:
        amount_str = str(amount)

    # Format sequence
    if seq_fmt == "zero_padded_2":
        seq_str = f"{seq:02d}"
    elif seq_fmt == "zero_padded_3":
        seq_str = f"{seq:03d}"
    else:
        seq_str = str(seq)

    # Override category for credit card
    if "信用卡" in (doc_type or "") or "credit_card" in (doc_type or "").lower():
        cc_override = special_rules.get("credit_card_statement", "")
        if cc_override:
            category_l2 = "信用卡账单"

    # Build filename from pattern
    mapping = {
        "{date}": date_str,
        "{person}": person,
        "{category_l1}": category_l2,  # fallback
        "{category_l2}": category_l2,
        "{amount}": amount_str,
        "{currency}": currency,
        "{seq}": seq_str,
    }

    result = pattern
    for key, val in mapping.items():
        result = result.replace(key, val)

    # Ensure extension
    ext = naming.get("extension", "preserve_original")
    if ext == "preserve_original":
        if not original_ext.startswith("."):
            original_ext = "." + original_ext
        result = result + original_ext
    elif ext:
        if not ext.startswith("."):
            ext = "." + ext
        result = result + ext

    # Sanitize filename (remove characters not allowed in filenames)
    invalid_chars = r'\/:*?"<>|'
    for ch in invalid_chars:
        result = result.replace(ch, "")

    return result


def summarize_naming(learned_naming: dict) -> str:
    """Return a human-readable summary for terminal display."""
    lines = []
    lines.append(f"[Step 0b] 文件命名规则学习结果 (置信度: {learned_naming.get('confidence', 'unknown')})")
    lines.append(f"  命名模式: {learned_naming.get('pattern', 'N/A')}")
    lines.append(f"  分隔符: '{learned_naming.get('separator', '_')}'")
    lines.append(f"  日期格式: {learned_naming.get('date_format', '%Y%m%d')}")
    lines.append(f"  分析样本数: {learned_naming.get('examples_analyzed', 0)}")
    samples = learned_naming.get("sample_filenames", [])
    if samples:
        lines.append(f"  样本示例: {samples[:3]}")
    lines.append(f"  备注: {learned_naming.get('notes', '')}")
    return "\n".join(lines)
