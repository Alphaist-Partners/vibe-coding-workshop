"""
main.py

Main orchestration for the expense automation tool.

Runtime flow:
  0. Learn formats (0a Excel, 0b naming)
  1. Get exchange rates
  2. Read invoice files
  3. OCR extract via Claude API
  4. Deduplication
  5. Classification
  6. Currency conversion
  7. Export
"""

import json
import logging
import os
import sys
from pathlib import Path

import yaml

# ── Project root: one level above src/ ──────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from src.learn_formats import learn_formats, summarize_formats
from src.learn_naming import learn_naming, summarize_naming
from src.exchange_rate import get_exchange_rates, convert_to_cny, format_rates_summary
from src.ocr_extract import batch_extract
from src.classifier import classify_batch, get_top_categories, _load_category_rules
from src.dedup import check_duplicates, check_within_batch_duplicates, save_to_processed
from src.exporter import (
    export_report,
    export_pending_review,
    rename_and_archive,
    generate_new_filenames,
)
from src.interactive import (
    get_user_inputs,
    confirm_learned_formats,
    handle_no_highlights,
    handle_duplicate,
    handle_low_confidence_classification,
    show_processing_start,
    show_success,
    show_warning,
    show_error,
    show_final_summary,
    show_records_table,
    ask_continue_on_error,
    confirm_relearn,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(PROJECT_ROOT / "data" / "expense_tool.log"), encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────

def _load_config(config_path: str) -> dict:
    """Load and expand environment variables in config.yaml."""
    with open(config_path, encoding="utf-8") as f:
        raw = f.read()

    # Expand ${ENV_VAR} patterns
    import re
    def _expand(m):
        var = m.group(1)
        val = os.environ.get(var, "")
        if not val:
            logger.warning(f"Environment variable ${{{var}}} is not set")
        return val

    expanded = re.sub(r"\$\{(\w+)\}", _expand, raw)
    return yaml.safe_load(expanded)


def _resolve_paths(config: dict) -> dict:
    """Resolve all relative paths in config to absolute paths."""
    ref = config.get("reference", {})
    for key in ("sample_report", "sample_files_dir", "learned_formats", "learned_naming", "category_rules"):
        val = ref.get(key, "")
        if val and not Path(val).is_absolute():
            ref[key] = str(PROJECT_ROOT / val)

    ex_cfg = config.get("exchange_rate", {})
    cache_dir = ex_cfg.get("cache_dir", "./data/exchange_rate_cache/")
    if not Path(cache_dir).is_absolute():
        ex_cfg["cache_dir"] = str(PROJECT_ROOT / cache_dir)

    return config


def _check_api_key_present():
    """Ensure an OpenAI-compatible API key is present in environment variables."""
    from os import environ
    if not (environ.get("DEEPSEEK_API_KEY") or environ.get("OPENAI_API_KEY")):
        logger.error("DEEPSEEK_API_KEY or OPENAI_API_KEY is not set. Put it in a .env file or export it.")
        print("ERROR: DEEPSEEK_API_KEY or OPENAI_API_KEY environment variable is not set.")
        print("Please set it: export DEEPSEEK_API_KEY=your_key_here")
        sys.exit(1)


def _check_sample_updates(config: dict) -> bool:
    """
    Check if sample files have been updated since last learning run.
    Returns True if re-learning is needed.
    """
    ref = config.get("reference", {})

    if config.get("reference", {}).get("force_relearn", False):
        return True

    learned_formats_path = Path(ref.get("learned_formats", ""))
    learned_naming_path = Path(ref.get("learned_naming", ""))

    if not learned_formats_path.exists() or not learned_naming_path.exists():
        return True

    # Check if sample_report.xlsx is newer than learned_formats.json
    sample_path = Path(ref.get("sample_report", ""))
    if sample_path.exists():
        if sample_path.stat().st_mtime > learned_formats_path.stat().st_mtime:
            return True

    # Check if any sample file is newer than learned_naming.json
    sample_files_dir = Path(ref.get("sample_files_dir", ""))
    if sample_files_dir.exists():
        for f in sample_files_dir.iterdir():
            if f.is_file() and f.stat().st_mtime > learned_naming_path.stat().st_mtime:
                return True

    return False


def run():
    """Main entry point."""
    # ── Load config ──────────────────────────────────────────────────────────
    config_path = PROJECT_ROOT / "config.yaml"
    if not config_path.exists():
        print(f"ERROR: config.yaml not found at {config_path}")
        sys.exit(1)

    config = _load_config(str(config_path))
    config = _resolve_paths(config)

    llm_cfg = config.get("llm", {})
    model = llm_cfg.get("model", "gpt-4o")

    _check_api_key_present()

    # ── Get user inputs ───────────────────────────────────────────────────────
    person, year, month_str = get_user_inputs()
    month = int(month_str)

    # ── Step 0: Learn formats ─────────────────────────────────────────────────
    show_processing_start(0, "学习样本格式")

    needs_relearn = _check_sample_updates(config)
    force_relearn = config.get("reference", {}).get("force_relearn", False)

    if not needs_relearn and not force_relearn:
        # Check if cached files exist
        ref = config.get("reference", {})
        learned_fmts_path = Path(ref.get("learned_formats", ""))
        learned_naming_path = Path(ref.get("learned_naming", ""))
        if learned_fmts_path.exists() and learned_naming_path.exists():
            show_success("发现已缓存的学习结果，跳过重新学习")
            needs_relearn = False

    learned_formats_dict, category_rules = learn_formats(config, force=needs_relearn)
    learned_naming_dict = learn_naming(config, force=needs_relearn)

    # Show summary and confirm
    formats_summary = summarize_formats(learned_formats_dict, category_rules)
    naming_summary = summarize_naming(learned_naming_dict)

    confirmed = confirm_learned_formats(formats_summary, naming_summary)
    if not confirmed:
        relearn = confirm_relearn("您选择了不确认，是否重新学习？")
        if relearn:
            learned_formats_dict, category_rules = learn_formats(config, force=True)
            learned_naming_dict = learn_naming(config, force=True)
            formats_summary = summarize_formats(learned_formats_dict, category_rules)
            naming_summary = summarize_naming(learned_naming_dict)
            show_success("重新学习完成")

    # ── Step 1: Get exchange rates ────────────────────────────────────────────
    show_processing_start(1, "获取汇率")
    try:
        rates = get_exchange_rates(config, year, month)
        show_success(f"汇率获取成功（{len(rates)} 种货币）")
        from rich.console import Console
        Console().print(format_rates_summary(rates))
    except Exception as e:
        logger.error(f"Exchange rate fetch failed: {e}")
        show_error(f"汇率获取失败: {e}")
        rates = {}

    # ── Step 2 & 3: Read and OCR invoices ────────────────────────────────────
    show_processing_start(2, "读取发票文件")

    invoice_dir = PROJECT_ROOT / "invoices"
    invoice_dir.mkdir(exist_ok=True)

    inv_files = [
        f for f in invoice_dir.iterdir()
        if f.is_file() and not f.name.startswith(".")
    ]

    if not inv_files:
        show_warning("invoices/ 目录中没有找到文件，请将发票/账单文件放入该目录后重新运行")
        sys.exit(0)

    show_success(f"找到 {len(inv_files)} 个文件")
    show_processing_start(3, "调用 Claude API 识别发票/账单")

    # Create OpenAI-compatible client wrapper
    from src.llm_client import get_client
    client = get_client()

    from rich.console import Console
    console = Console()

    def progress_cb(current, total, filename):
        pct = int(current / total * 100)
        console.print(f"  [{current}/{total}] ({pct}%) {filename}")

    all_records: list[dict] = []

    raw_records = batch_extract(
        str(invoice_dir),
        client,
        model,
        progress_callback=progress_cb,
    )

    # Handle credit card statements with no highlights
    for record in raw_records:
        if record.get("doc_type") == "外币信用卡账单" and record.get("has_highlights") is False:
            action = handle_no_highlights(record.get("original_filename", ""))
            if action == "skip":
                record["skipped"] = True
                record["skip_reason"] = "用户选择跳过（无高亮标记）"
                all_records.append(record)
            elif action == "manual":
                # Interactive: ask user to describe which items to include
                # For now, mark as needs_review
                record["needs_review"] = True
                record["pending_reason"] = "信用卡账单无高亮，需手动确认"
                all_records.append(record)
            elif action == "all":
                # Will need to re-extract without highlight filter
                # For simplicity, mark and include
                record["notes"] = (record.get("notes") or "") + " | 用户确认纳入整张账单"
                all_records.append(record)
        else:
            all_records.append(record)

    show_success(f"识别完成，共 {len(all_records)} 条记录")

    # ── Step 4: Deduplication ─────────────────────────────────────────────────
    show_processing_start(4, "检查重复")

    processed_json = str(PROJECT_ROOT / "data" / "processed.json")
    active_records = [r for r in all_records if not r.get("skipped")]

    # Check within-batch duplicates
    within_batch_pairs = check_within_batch_duplicates(active_records)
    if within_batch_pairs:
        show_warning(f"发现 {len(within_batch_pairs)} 对批次内重复记录")
        for i, j in within_batch_pairs:
            console.print(f"  记录 {i+1} ({active_records[i].get('original_filename')}) "
                         f"与记录 {j+1} ({active_records[j].get('original_filename')}) 疑似重复")

    # Check against processed.json
    duplicates = check_duplicates(active_records, config, processed_json)

    for dup_record in duplicates:
        action = handle_duplicate(dup_record, dup_record.get("duplicate_of", {}))
        if action == "skip":
            dup_record["skipped"] = True
            dup_record["skip_reason"] = "重复记录，用户选择跳过"
        else:
            dup_record["is_duplicate"] = False  # user confirmed to include
            show_success(f"用户确认纳入重复记录: {dup_record.get('original_filename')}")

    non_skipped = [r for r in all_records if not r.get("skipped")]
    show_success(f"去重完成，{len(non_skipped)} 条记录将继续处理")

    # ── Step 5: Classification ────────────────────────────────────────────────
    show_processing_start(5, "费用分类")

    ref_cfg = config.get("reference", {})
    rules_path = ref_cfg.get("category_rules", str(PROJECT_ROOT / "reference" / "category_rules.json"))
    loaded_rules = _load_category_rules(rules_path)
    if not loaded_rules:
        loaded_rules = category_rules  # use in-memory rules

    def classify_progress(current, total, filename):
        console.print(f"  [{current}/{total}] 分类: {filename}")

    low_conf_indices = classify_batch(
        non_skipped,
        client,
        model,
        loaded_rules,
        progress_callback=classify_progress,
    )

    # Handle low-confidence classifications interactively
    for idx in low_conf_indices:
        record = non_skipped[idx]
        suggestions = get_top_categories(record, client, model, loaded_rules, top_n=3)
        selected = handle_low_confidence_classification(record, suggestions)
        record.update(selected)
        show_success(f"已确认分类: {record.get('category_l1')} / {record.get('category_l2')}")

    show_success("分类完成")

    # ── Step 6: Currency conversion ───────────────────────────────────────────
    show_processing_start(6, "汇率换算")

    for record in non_skipped:
        currency = str(record.get("currency", "CNY")).upper()
        amount_raw = record.get("amount")

        if not amount_raw:
            record["amount_cny"] = 0.0
            record["exchange_rate"] = 1.0
            continue

        try:
            amount_float = float(str(amount_raw).replace(",", ""))
        except (ValueError, TypeError):
            logger.warning(f"Cannot parse amount '{amount_raw}' for {record.get('original_filename')}")
            record["amount_cny"] = 0.0
            record["exchange_rate"] = 1.0
            continue

        if currency in ("CNY", "RMB"):
            record["amount_cny"] = round(amount_float, 2)
            record["exchange_rate"] = 1.0
        else:
            cny_amount, rate = convert_to_cny(amount_float, currency, rates)
            record["amount_cny"] = cny_amount
            record["exchange_rate"] = rate

    show_success("汇率换算完成")

    # ── Step 7: Export ────────────────────────────────────────────────────────
    show_processing_start(7, "生成报告和归档文件")

    output_cfg = config.get("output", {})
    output_dir = PROJECT_ROOT / "output"
    output_dir.mkdir(exist_ok=True)

    report_filename = output_cfg.get("report_filename", "expense_report.xlsx")
    pending_filename = output_cfg.get("pending_filename", "pending_review.xlsx")
    renamed_dir_name = output_cfg.get("renamed_dir", "renamed_files")

    report_path = output_dir / report_filename
    pending_path = output_dir / pending_filename
    renamed_base = output_dir / renamed_dir_name

    # Generate new filenames
    generate_new_filenames(non_skipped, learned_naming_dict, person)

    # Add sequence number as "seq" field for display
    for idx, r in enumerate(non_skipped, 1):
        r["display_seq"] = idx

    # Export main report
    report_out = export_report(
        records=non_skipped,
        output_path=str(report_path),
        learned_formats=learned_formats_dict,
        title=f"{year}年{month_str}月 {person} 费用报销明细",
    )
    show_success(f"报销报表已生成: {report_out}")

    # Export pending review
    pending_records = [r for r in non_skipped if r.get("needs_review")]
    pending_out = export_pending_review(pending_records, str(pending_path))
    if pending_out:
        show_warning(f"有 {len(pending_records)} 条待确认记录: {pending_out}")

    # Rename and archive files
    rename_map = rename_and_archive(non_skipped, str(renamed_base), person)
    show_success(f"文件已归档: {len(rename_map)} 个文件 -> {renamed_base / person}")

    # Update processed.json
    save_to_processed(non_skipped, processed_json)
    show_success("已更新 processed.json")

    # ── Final summary ─────────────────────────────────────────────────────────
    show_records_table(all_records)
    show_final_summary(
        person=person,
        year=year,
        month=month_str,
        records=all_records,
        output_path=report_out,
        pending_path=pending_out if pending_records else None,
        renamed_dir=str(renamed_base / person) if rename_map else None,
    )


if __name__ == "__main__":
    # Ensure data directory exists
    (PROJECT_ROOT / "data").mkdir(exist_ok=True)
    run()
