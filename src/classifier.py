"""
classifier.py

Uses Claude API to classify expense records into categories.
Reads category_rules.json for context.
"""

import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

CLASSIFICATION_PROMPT_TEMPLATE = """你是一位专业的基金 GP 的财务助理。请根据以下信息对这笔费用进行分类。

【发票/账单信息】
{invoice_info}

【文件名】
{filename}

【分类规则】
{category_rules}

请仔细分析费用内容，返回分类结果。

返回 JSON 格式（只返回JSON，不要其他文字）：
{{
  "category_l1": "一级分类",
  "category_l2": "二级分类",
  "category_l3": "三级分类（如适用，否则为空字符串）",
  "confidence": "high/medium/low",
  "reasoning": "简要说明分类依据（1-2句话）"
}}"""


def _load_category_rules(rules_path: str) -> list[dict]:
    """Load category rules from JSON file."""
    path = Path(rules_path)
    if not path.exists():
        logger.warning(f"category_rules.json not found: {rules_path}")
        return []
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load category_rules: {e}")
        return []


def _format_invoice_info(record: dict) -> str:
    """Format relevant invoice fields for the prompt."""
    fields = [
        ("文档类型", "doc_type"),
        ("日期", "date"),
        ("供应商", "vendor"),
        ("费用描述", "description"),
        ("金额", "amount"),
        ("货币", "currency"),
        ("税额", "tax_amount"),
    ]
    lines = []
    for label, key in fields:
        val = record.get(key)
        if val is not None and val != "":
            lines.append(f"- {label}: {val}")
    return "\n".join(lines) if lines else "（无详细信息）"


def _format_category_rules(rules: list[dict]) -> str:
    """Format category rules as readable text for the prompt."""
    if not rules:
        return "（无预定义规则，请根据常识判断）"

    # Group by l1
    grouped: dict[str, list[dict]] = {}
    for rule in rules:
        l1 = rule.get("l1") or rule.get("category_l1") or "其他"
        if l1 not in grouped:
            grouped[l1] = []
        grouped[l1].append(rule)

    lines = []
    for l1, items in grouped.items():
        l2_list = []
        for item in items:
            l2 = item.get("l2") or item.get("category_l2") or ""
            keywords = item.get("keywords", [])
            if l2:
                if keywords:
                    l2_list.append(f"{l2}（关键词：{', '.join(keywords[:5])}）")
                else:
                    l2_list.append(l2)
        if l2_list:
            lines.append(f"- {l1}：{' / '.join(l2_list)}")
        else:
            lines.append(f"- {l1}")

    return "\n".join(lines)


def _parse_classification_response(text: str) -> Optional[dict]:
    """Extract JSON from Claude's classification response."""
    if not text:
        return None

    # Direct parse
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # Extract from code block
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Find raw JSON
    m = re.search(r"(\{[\s\S]*\})", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    return None


def classify_expense(
    record: dict,
    client,
    model: str,
    category_rules: list[dict],
) -> dict[str, Any]:
    """
    Classify a single expense record.

    Returns dict with: category_l1, category_l2, category_l3, confidence, reasoning
    """
    invoice_info = _format_invoice_info(record)
    filename = record.get("original_filename", "")
    rules_text = _format_category_rules(category_rules)

    prompt = CLASSIFICATION_PROMPT_TEMPLATE.format(
        invoice_info=invoice_info,
        filename=filename,
        category_rules=rules_text,
    )

    try:
        message = client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = message.content[0].text
    except Exception as e:
        logger.error(f"Claude classification API call failed: {e}")
        return _default_classification("API调用失败")

    result = _parse_classification_response(response_text)
    if not result:
        logger.warning(f"Failed to parse classification response for {filename}")
        return _default_classification("解析失败")

    # Normalize confidence
    confidence_raw = str(result.get("confidence", "low")).lower()
    if confidence_raw in ("high", "高"):
        confidence = "high"
    elif confidence_raw in ("medium", "中"):
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "category_l1": result.get("category_l1", "其他"),
        "category_l2": result.get("category_l2", "其他"),
        "category_l3": result.get("category_l3", ""),
        "confidence": confidence,
        "reasoning": result.get("reasoning", ""),
    }


def _default_classification(reason: str = "") -> dict[str, Any]:
    return {
        "category_l1": "其他",
        "category_l2": "其他",
        "category_l3": "",
        "confidence": "low",
        "reasoning": reason or "无法自动分类",
    }


def classify_batch(
    records: list[dict],
    client,
    model: str,
    category_rules: list[dict],
    low_confidence_threshold: float = 0.8,
    progress_callback=None,
) -> list[dict]:
    """
    Classify a batch of expense records.

    Adds classification fields to each record in place.
    Returns list of records that need interactive confirmation (confidence < threshold).

    Args:
        records: List of expense record dicts (modified in place)
        client: Anthropic client
        model: Claude model name
        category_rules: List of category rule dicts
        low_confidence_threshold: confidence below this needs human confirmation
        progress_callback: Optional callback(current, total, filename)

    Returns:
        List of indices into `records` that need human review.
    """
    needs_review_indices = []

    for idx, record in enumerate(records):
        filename = record.get("original_filename", f"record_{idx}")
        if progress_callback:
            progress_callback(idx + 1, len(records), filename)

        logger.info(f"Classifying [{idx+1}/{len(records)}]: {filename}")

        classification = classify_expense(record, client, model, category_rules)
        record.update(classification)

        # Flag low-confidence items
        if classification["confidence"] in ("low", "medium"):
            needs_review_indices.append(idx)
            logger.info(f"  → Low confidence ({classification['confidence']}), needs review")
        else:
            logger.info(f"  → {classification['category_l1']} / {classification['category_l2']} ({classification['confidence']})")

    return needs_review_indices


def get_top_categories(
    record: dict,
    client,
    model: str,
    category_rules: list[dict],
    top_n: int = 3,
) -> list[dict]:
    """
    Get top N most likely categories for a record (for interactive selection).

    Returns list of {category_l1, category_l2, category_l3, confidence, reasoning}
    """
    invoice_info = _format_invoice_info(record)
    filename = record.get("original_filename", "")
    rules_text = _format_category_rules(category_rules)

    prompt = f"""你是一位专业的基金 GP 的财务助理。请根据以下信息对这笔费用进行分类。

【发票/账单信息】
{invoice_info}

【文件名】
{filename}

【分类规则】
{rules_text}

请给出最可能的 {top_n} 种分类，按可能性从高到低排列。

返回 JSON 格式（只返回JSON，不要其他文字）：
{{
  "suggestions": [
    {{
      "category_l1": "一级分类",
      "category_l2": "二级分类",
      "category_l3": "三级分类（可为空字符串）",
      "confidence": "high/medium/low",
      "reasoning": "分类理由"
    }}
  ]
}}"""

    try:
        message = client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = message.content[0].text
        result = _parse_classification_response(response_text)
        if result and "suggestions" in result:
            return result["suggestions"][:top_n]
    except Exception as e:
        logger.error(f"Failed to get top categories: {e}")

    # Fallback
    return [_default_classification()]
