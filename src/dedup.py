"""
dedup.py

Duplicate detection for expense records.

- Chinese invoices: exact match on invoice_code + invoice_number
- International invoices: fuzzy match on vendor + date + amount + currency
- Credit card items: match on card_last_four + date + amount + vendor
"""

import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _load_processed(processed_path: str) -> list[dict]:
    """Load previously processed records from processed.json."""
    path = Path(processed_path)
    if not path.exists():
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return data.get("records", [])
    except Exception as e:
        logger.error(f"Failed to load processed.json: {e}")
        return []


def _save_processed(processed_path: str, records: list[dict]) -> None:
    """Save processed records to processed.json."""
    path = Path(processed_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"records": records}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save processed.json: {e}")


def _normalize_str(s: Any) -> str:
    """Normalize a string for comparison."""
    if s is None:
        return ""
    return str(s).strip().lower().replace(" ", "")


def _fuzzy_match(s1: str, s2: str, threshold: float = 0.95) -> bool:
    """
    Check if two strings are fuzzy-match similar above the threshold.
    Uses token_sort_ratio from fuzzywuzzy.
    """
    if not s1 or not s2:
        return s1 == s2
    try:
        from fuzzywuzzy import fuzz
        ratio = fuzz.token_sort_ratio(s1, s2) / 100.0
        return ratio >= threshold
    except ImportError:
        # Simple exact match fallback
        return s1 == s2


def _amount_close(a1: Any, a2: Any, tolerance: float = 0.01) -> bool:
    """Check if two amounts are close enough to be considered equal."""
    try:
        return abs(float(a1) - float(a2)) <= tolerance
    except (ValueError, TypeError):
        return _normalize_str(a1) == _normalize_str(a2)


def _is_cn_invoice_duplicate(record: dict, existing: dict) -> bool:
    """Check if two Chinese invoices are duplicates."""
    code1 = _normalize_str(record.get("invoice_code"))
    code2 = _normalize_str(existing.get("invoice_code"))
    num1 = _normalize_str(record.get("invoice_number"))
    num2 = _normalize_str(existing.get("invoice_number"))

    if not code1 or not num1:
        return False  # Cannot determine without invoice code/number

    return code1 == code2 and num1 == num2


def _is_intl_invoice_duplicate(record: dict, existing: dict, threshold: float = 0.95) -> bool:
    """Check if two international invoices/receipts are duplicates."""
    vendor1 = _normalize_str(record.get("vendor"))
    vendor2 = _normalize_str(existing.get("vendor"))
    date1 = _normalize_str(record.get("date"))
    date2 = _normalize_str(existing.get("date"))
    currency1 = _normalize_str(record.get("currency"))
    currency2 = _normalize_str(existing.get("currency"))

    if not vendor1 or not date1:
        return False

    # Date and currency must match exactly
    if date1 != date2 or currency1 != currency2:
        return False

    # Vendor fuzzy match
    if not _fuzzy_match(vendor1, vendor2, threshold):
        return False

    # Amount must be close
    return _amount_close(record.get("amount"), existing.get("amount"))


def _is_credit_card_duplicate(record: dict, existing: dict, threshold: float = 0.95) -> bool:
    """Check if two credit card transaction entries are duplicates."""
    card1 = _normalize_str(record.get("card_last_four"))
    card2 = _normalize_str(existing.get("card_last_four"))
    date1 = _normalize_str(record.get("date"))
    date2 = _normalize_str(existing.get("date"))
    vendor1 = _normalize_str(record.get("vendor"))
    vendor2 = _normalize_str(existing.get("vendor"))

    if card1 != card2 or date1 != date2:
        return False

    if not _amount_close(record.get("amount"), existing.get("amount")):
        return False

    return _fuzzy_match(vendor1, vendor2, threshold)


def _is_duplicate(record: dict, existing: dict, threshold: float = 0.95) -> bool:
    """Dispatch duplicate check based on doc_type."""
    doc_type = str(record.get("doc_type", "")).lower()
    existing_type = str(existing.get("doc_type", "")).lower()

    # Types must broadly match
    both_cn = any(t in doc_type for t in ["增值税", "中国", "电子发票", "火车", "机票"])
    both_existing_cn = any(t in existing_type for t in ["增值税", "中国", "电子发票", "火车", "机票"])

    if "信用卡" in doc_type and "信用卡" in existing_type:
        return _is_credit_card_duplicate(record, existing, threshold)
    elif both_cn and both_existing_cn:
        return _is_cn_invoice_duplicate(record, existing)
    else:
        return _is_intl_invoice_duplicate(record, existing, threshold)


def check_duplicates(
    records: list[dict],
    config: dict,
    processed_json_path: str = "./data/processed.json",
) -> list[dict]:
    """
    Check each record against previously processed records.

    Adds 'is_duplicate' and 'duplicate_of' fields to records with potential duplicates.
    Returns list of records flagged as potential duplicates.

    Args:
        records: New records to check
        config: Configuration dict
        processed_json_path: Path to processed.json

    Returns:
        List of records that are potentially duplicates.
    """
    dedup_cfg = config.get("dedup", {})
    threshold = float(dedup_cfg.get("fuzzy_match_threshold", 0.95))

    existing_records = _load_processed(processed_json_path)
    duplicates = []

    for record in records:
        record["is_duplicate"] = False
        record["duplicate_of"] = None

        for existing in existing_records:
            if _is_duplicate(record, existing, threshold):
                record["is_duplicate"] = True
                record["duplicate_of"] = {
                    "original_filename": existing.get("original_filename", ""),
                    "date": existing.get("date", ""),
                    "vendor": existing.get("vendor", ""),
                    "amount": existing.get("amount", ""),
                    "invoice_number": existing.get("invoice_number", ""),
                }
                duplicates.append(record)
                logger.warning(
                    f"Duplicate detected: {record.get('original_filename')} "
                    f"matches {existing.get('original_filename', 'unknown')}"
                )
                break

    return duplicates


def check_within_batch_duplicates(records: list[dict], threshold: float = 0.95) -> list[tuple[int, int]]:
    """
    Check for duplicates within the current batch (not against processed.json).

    Returns list of (idx1, idx2) pairs that are duplicates.
    """
    duplicate_pairs = []
    for i in range(len(records)):
        for j in range(i + 1, len(records)):
            if _is_duplicate(records[i], records[j], threshold):
                duplicate_pairs.append((i, j))
                logger.warning(
                    f"Within-batch duplicate: record {i} ({records[i].get('original_filename')}) "
                    f"and record {j} ({records[j].get('original_filename')})"
                )
    return duplicate_pairs


def save_to_processed(
    records: list[dict],
    processed_json_path: str = "./data/processed.json",
) -> None:
    """
    Append successfully processed records to processed.json.
    """
    existing = _load_processed(processed_json_path)

    # Only save records that were actually processed (not skipped due to duplicates)
    new_records = [r for r in records if not r.get("skipped", False)]

    # Add unique identifier fields for future dedup
    all_records = existing + new_records
    _save_processed(processed_json_path, all_records)
    logger.info(f"Updated processed.json: {len(existing)} existing + {len(new_records)} new = {len(all_records)} total")
