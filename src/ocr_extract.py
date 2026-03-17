"""
ocr_extract.py

Uses Claude API (vision) to extract structured data from invoices, receipts,
and credit card statements.

Supports: PDF, JPG, PNG, HEIC
"""

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".tiff", ".tif"}

# Prompt for general invoice/receipt
GENERAL_INVOICE_PROMPT = """你是一位专业的财务文件识别专家。请仔细分析这张图片，提取所有财务信息。

请判断文件类型：
- 中国增值税普通发票
- 中国增值税专用发票
- 中国电子发票
- 中国火车票
- 中国机票行程单
- 海外 receipt（小票/收据）
- 海外 invoice（发票）
- 外币信用卡账单
- 其他

然后提取以下信息，以 JSON 格式返回：

{
  "doc_type": "文档类型（如上分类之一）",
  "invoice_code": "发票代码（仅中国发票，没有则为null）",
  "invoice_number": "发票号码（仅中国发票，没有则为null）",
  "date": "开票/消费日期，格式 YYYY-MM-DD，无法识别则为null",
  "vendor": "供应商/卖方/商户名称",
  "description": "费用描述，含商品或服务名称",
  "amount": "金额数字（价税合计或total），不含货币符号",
  "tax_amount": "税额数字，没有则为null",
  "currency": "货币代码：CNY/USD/HKD/EUR/GBP/JPY/SGD/AUD/CAD/CHF等",
  "card_last_four": "信用卡后四位，非信用卡则为null",
  "notes": "任何需要备注的信息，如OCR不清晰等"
}

注意：
- 金额只返回数字，不要包含货币符号
- 日期统一格式化为 YYYY-MM-DD
- 如果信息不清晰或无法识别，返回null而不是猜测
- 只返回JSON，不要包含其他文字"""

# Prompt specifically for credit card statements
CREDIT_CARD_PROMPT = """这是一张外币信用卡账单。请注意：
1. 账单中有些消费条目被角标记/高亮标记过（可能是黑色圈、蓝色标记、绿色高亮、手写标注等任何形式的标记）
2. 请仅提取被高亮/标记的消费条目，忽略所有未标记的条目
3. 对于每条高亮的消费，提取：交易日期、商户名称、交易金额、货币
4. 如果你不确定某条是否被高亮，请标记 confidence 为 low 并在 notes 中说明
5. 如果整页都没有看到明显的高亮标记，请返回空列表并说明原因

请提取账单基本信息和高亮条目，以 JSON 格式返回：

{
  "doc_type": "外币信用卡账单",
  "card_last_four": "卡号后四位",
  "statement_period": "账单周期，如 2025-02-01 to 2025-02-28",
  "currency": "账单主要货币",
  "highlighted_items": [
    {
      "date": "交易日期 YYYY-MM-DD",
      "vendor": "商户名称",
      "amount": "金额数字",
      "currency": "货币代码",
      "is_highlighted": true,
      "confidence": "high/medium/low",
      "notes": "备注"
    }
  ],
  "has_highlights": true/false,
  "no_highlight_reason": "如果没有高亮，说明原因",
  "notes": "其他备注"
}

注意：只返回JSON，不要包含其他文字"""


def _read_pdf_pages(pdf_path: str) -> list[tuple[bytes, str]]:
    """
    Convert PDF pages to images using pymupdf.
    Returns list of (image_bytes, media_type) tuples.
    """
    try:
        import fitz  # pymupdf
    except ImportError:
        logger.error("pymupdf not installed. Cannot process PDF files.")
        return []

    images = []
    try:
        doc = fitz.open(pdf_path)
        for page_num in range(len(doc)):
            page = doc[page_num]
            # Render at 2x resolution for better OCR
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            images.append((img_bytes, "image/png"))
        doc.close()
    except Exception as e:
        logger.error(f"Failed to convert PDF {pdf_path}: {e}")

    return images


def _read_heic(heic_path: str) -> tuple[bytes, str]:
    """Convert HEIC to JPEG using pillow-heif."""
    try:
        import pillow_heif
        from PIL import Image
        import io

        pillow_heif.register_heif_opener()
        with Image.open(heic_path) as img:
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=95)
            return buf.getvalue(), "image/jpeg"
    except ImportError:
        logger.error("pillow-heif not installed. Cannot process HEIC files.")
        return b"", ""
    except Exception as e:
        logger.error(f"Failed to convert HEIC {heic_path}: {e}")
        return b"", ""


def _read_image(image_path: str) -> tuple[bytes, str]:
    """Read an image file and return (bytes, media_type)."""
    ext = Path(image_path).suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
    }
    media_type = media_types.get(ext, "image/jpeg")
    try:
        with open(image_path, "rb") as f:
            return f.read(), media_type
    except Exception as e:
        logger.error(f"Failed to read image {image_path}: {e}")
        return b"", ""


def _call_claude_vision(
    client,
    model: str,
    image_bytes: bytes,
    media_type: str,
    prompt: str,
) -> Optional[str]:
    """
    Send an image to Claude API and get text response.
    """
    if not image_bytes:
        return None

    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    try:
        message = client.messages.create(
            model=model,
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        },
                    ],
                }
            ],
        )
        return message.content[0].text
    except Exception as e:
        logger.error(f"Claude API call failed: {e}")
        return None


def _parse_json_response(text: str) -> Optional[dict]:
    """Extract JSON from Claude's response text."""
    if not text:
        return None

    # Try direct parse
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # Try to extract JSON block
    json_pattern = r"```(?:json)?\s*(\{[\s\S]*?\})\s*```"
    m = re.search(json_pattern, text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Try to find raw JSON object
    brace_pattern = r"(\{[\s\S]*\})"
    m = re.search(brace_pattern, text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    logger.warning(f"Could not parse JSON from response: {text[:200]}...")
    return None


def _detect_doc_type(filename: str) -> str:
    """Quick heuristic to detect document type from filename."""
    fn_lower = filename.lower()
    if "信用卡" in filename or "credit" in fn_lower or "statement" in fn_lower:
        return "外币信用卡账单"
    if "机票" in filename or "行程单" in filename:
        return "中国机票行程单"
    if "火车" in filename or "高铁" in filename:
        return "中国火车票"
    return "unknown"


def extract_invoice(
    file_path: str,
    client,
    model: str,
    hint_type: str = "auto",
) -> list[dict[str, Any]]:
    """
    Extract structured data from an invoice/receipt file.

    Args:
        file_path: Path to the file
        client: Anthropic client instance
        model: Claude model name
        hint_type: 'auto', 'credit_card', 'invoice'

    Returns:
        List of extracted record dicts. Usually one record, but credit card
        statements may return multiple (one per highlighted item).
    """
    path = Path(file_path)
    ext = path.suffix.lower()
    filename = path.name

    if ext not in SUPPORTED_EXTENSIONS:
        logger.warning(f"Unsupported file type: {ext}")
        return []

    # Determine if this is likely a credit card statement
    is_credit_card = (
        hint_type == "credit_card"
        or "信用卡" in filename
        or "credit" in filename.lower()
        or "statement" in filename.lower()
    )

    # Get image data
    image_list: list[tuple[bytes, str]] = []

    if ext == ".pdf":
        image_list = _read_pdf_pages(str(path))
    elif ext in {".heic", ".heif"}:
        img_bytes, media_type = _read_heic(str(path))
        if img_bytes:
            image_list = [(img_bytes, media_type)]
    else:
        img_bytes, media_type = _read_image(str(path))
        if img_bytes:
            image_list = [(img_bytes, media_type)]

    if not image_list:
        logger.error(f"Could not load images from {file_path}")
        return []

    results = []

    if is_credit_card:
        # Process all pages together for credit card statements
        # For multi-page PDFs, process first page then subsequent pages
        for page_idx, (img_bytes, media_type) in enumerate(image_list):
            prompt = CREDIT_CARD_PROMPT
            response_text = _call_claude_vision(client, model, img_bytes, media_type, prompt)
            parsed = _parse_json_response(response_text)

            if parsed is None:
                logger.warning(f"Failed to parse response for page {page_idx+1} of {filename}")
                continue

            highlighted = parsed.get("highlighted_items", [])
            has_highlights = parsed.get("has_highlights", False)
            card_last_four = parsed.get("card_last_four", "")

            if not has_highlights or not highlighted:
                # Return a sentinel record indicating no highlights
                results.append({
                    "doc_type": "外币信用卡账单",
                    "original_filename": filename,
                    "card_last_four": card_last_four,
                    "has_highlights": False,
                    "no_highlight_reason": parsed.get("no_highlight_reason", "No highlighted items found"),
                    "statement_period": parsed.get("statement_period", ""),
                    "currency": parsed.get("currency", ""),
                    "notes": f"Page {page_idx+1}: No highlights detected",
                    "raw_response": parsed,
                })
            else:
                for item_idx, item in enumerate(highlighted):
                    record = {
                        "doc_type": "外币信用卡账单",
                        "original_filename": filename,
                        "card_last_four": card_last_four,
                        "date": item.get("date"),
                        "vendor": item.get("vendor", ""),
                        "description": item.get("vendor", ""),
                        "amount": item.get("amount"),
                        "currency": item.get("currency", parsed.get("currency", "")),
                        "is_highlighted": True,
                        "confidence": item.get("confidence", "medium"),
                        "notes": f"来自信用卡账单第{item_idx+1}笔; " + (item.get("notes") or ""),
                        "statement_period": parsed.get("statement_period", ""),
                    }
                    results.append(record)
    else:
        # Standard invoice processing - process first page (or all pages for multi-page)
        all_text_parts = []
        for page_idx, (img_bytes, media_type) in enumerate(image_list):
            response_text = _call_claude_vision(
                client, model, img_bytes, media_type, GENERAL_INVOICE_PROMPT
            )
            if response_text:
                all_text_parts.append(response_text)
            # For invoices, usually first page is sufficient
            if page_idx == 0 and len(image_list) > 1:
                # Check if we got a good parse
                parsed = _parse_json_response(response_text)
                if parsed and parsed.get("amount"):
                    break

        # Parse the first successful response
        for text in all_text_parts:
            parsed = _parse_json_response(text)
            if parsed:
                parsed["original_filename"] = filename
                results.append(parsed)
                break

        if not results:
            logger.warning(f"Could not extract data from {filename}")
            results.append({
                "doc_type": "其他",
                "original_filename": filename,
                "notes": "OCR提取失败，请手动填写",
                "error": True,
            })

    return results


def batch_extract(
    invoice_dir: str,
    client,
    model: str,
    progress_callback=None,
) -> list[dict[str, Any]]:
    """
    Extract data from all invoice files in a directory.

    Args:
        invoice_dir: Directory containing invoice files
        client: Anthropic client
        model: Claude model name
        progress_callback: Optional callback(current, total, filename) for progress

    Returns:
        List of all extracted records
    """
    inv_path = Path(invoice_dir)
    if not inv_path.exists():
        logger.error(f"Invoice directory not found: {invoice_dir}")
        return []

    files = [
        f for f in inv_path.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
        and not f.name.startswith(".")
    ]

    if not files:
        logger.warning(f"No supported invoice files found in {invoice_dir}")
        return []

    logger.info(f"Found {len(files)} invoice files to process")
    all_records = []

    for idx, file_path in enumerate(files):
        if progress_callback:
            progress_callback(idx + 1, len(files), file_path.name)

        logger.info(f"Processing [{idx+1}/{len(files)}]: {file_path.name}")
        records = extract_invoice(str(file_path), client, model)

        for record in records:
            if "original_filename" not in record:
                record["original_filename"] = file_path.name
            record["source_path"] = str(file_path)

        all_records.extend(records)

    return all_records
