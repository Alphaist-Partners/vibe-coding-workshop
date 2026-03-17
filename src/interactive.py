"""
interactive.py

Terminal UI for interactive user prompts using the rich library.
Handles all scenarios where human input is needed.
Supports non-interactive mode via environment variables when NO_INTERACTIVE=true.
"""

import logging
import sys
import os
from typing import Any, Optional

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table
from rich import print as rprint
from rich.text import Text

logger = logging.getLogger(__name__)
console = Console()


def _ask_with_default(prompt_text: str, choices: list[str] = None, default: str = None, env_var: str = None) -> str:
    """
    Custom Prompt.ask that supports non-interactive mode via env var.
    If env_var is set in environment and in choices, return that value.
    Otherwise, use default or fall back to rich Prompt.ask()
    """
    if env_var:
        env_value = os.environ.get(env_var)
        if env_value:
            if choices is None or env_value in choices:
                logger.info(f"Using env var {env_var}={env_value} for prompt: {prompt_text}")
                return env_value
    
    # Fall back to interactive prompt
    return Prompt.ask(prompt_text, choices=choices, default=default)



def get_user_inputs() -> tuple[str, int, str]:
    """
    Prompt user for basic reimbursement information.

    Returns:
        (person_name, year, month_str) e.g. ("张三", 2025, "03")
    """
    console.print()
    console.print(Panel("[bold cyan]费用报销自动化工具[/bold cyan]", expand=False))
    console.print()

    person = Prompt.ask("[bold]请输入报销人姓名[/bold]").strip()
    while not person:
        console.print("[red]姓名不能为空，请重新输入[/red]")
        person = Prompt.ask("[bold]请输入报销人姓名[/bold]").strip()

    year_str = Prompt.ask("[bold]请输入报销年度[/bold]（如 2025）").strip()
    while not year_str.isdigit() or not (2000 <= int(year_str) <= 2099):
        console.print("[red]请输入有效的年份（2000-2099）[/red]")
        year_str = Prompt.ask("[bold]请输入报销年度[/bold]（如 2025）").strip()
    year = int(year_str)

    month_str = Prompt.ask("[bold]请输入报销月度[/bold]（如 03）").strip()
    # Normalize month
    try:
        month_val = int(month_str)
        if not (1 <= month_val <= 12):
            raise ValueError()
        month_str = f"{month_val:02d}"
    except ValueError:
        while True:
            console.print("[red]请输入有效的月份（01-12）[/red]")
            month_str = Prompt.ask("[bold]请输入报销月度[/bold]（如 03）").strip()
            try:
                month_val = int(month_str)
                if 1 <= month_val <= 12:
                    month_str = f"{month_val:02d}"
                    break
            except ValueError:
                pass

    console.print()
    console.print(f"[green]✓ 报销人: {person}  |  年度: {year}  |  月度: {month_str}[/green]")
    console.print()

    return person, year, month_str


def confirm_learned_formats(formats_summary: str, naming_summary: str) -> bool:
    """
    Show format/naming learning results and ask user to confirm.
    Non-interactive mode: reads AUTO_CONFIRM_FORMATS env var (default: false, uses True).
    Returns True if confirmed, False if not.
    """
    # Non-interactive mode: auto-confirm if env var is set
    env_confirm = os.environ.get("AUTO_CONFIRM_FORMATS", "false").lower()
    if env_confirm == "true":
        logger.info("Auto-confirming learned formats")
        return True

    console.print()
    console.print(Panel("[bold]Step 0: 学习样本格式结果[/bold]", expand=False))
    console.print(formats_summary)
    console.print()
    console.print(naming_summary)
    console.print()

    return Confirm.ask("以上学习结果是否正确？请确认后继续", default=True)


def handle_no_highlights(filename: str) -> str:
    """
    Handle credit card statement with no highlighted items.
    Non-interactive mode: reads NO_HIGHLIGHT_ACTION env var (default: skip).
    Returns one of: 'skip', 'manual', 'all'
    """
    # Non-interactive mode: check env var for auto-choice
    env_choice = os.environ.get("NO_HIGHLIGHT_ACTION", "skip").lower()
    if env_choice in ("skip", "manual", "all"):
        logger.info(f"No-highlight action from env: {env_choice}")
        return env_choice

    console.print()
    console.print(Panel(
        f"[yellow]⚠ 注意：信用卡账单 '{filename}' 中未检测到任何高亮标记[/yellow]",
        expand=False
    ))
    console.print()
    console.print("请选择处理方式：")
    console.print("  [bold]1[/bold]. 跳过此账单（不纳入报销）")
    console.print("  [bold]2[/bold]. 手动指定要报销的条目（进入交互模式）")
    console.print("  [bold]3[/bold]. 纳入整张账单的所有消费（不推荐）")
    console.print()

    while True:
        choice = Prompt.ask("请选择", choices=["1", "2", "3"], default="1")
        if choice == "1":
            return "skip"
        elif choice == "2":
            return "manual"
        elif choice == "3":
            return "all"


def handle_duplicate(
    record: dict,
    duplicate_of: dict,
) -> str:
    """
    Show duplicate warning and ask how to proceed.
    Non-interactive mode: reads DUPLICATE_ACTION env var (default: skip).
    Returns one of: 'skip', 'include'
    """
    # Non-interactive mode: check env var for auto-choice
    env_choice = os.environ.get("DUPLICATE_ACTION", "skip").lower()
    if env_choice in ("skip", "include"):
        logger.info(f"Duplicate action from env: {env_choice}")
        return env_choice

    console.print()
    console.print(Panel("[yellow]⚠ 检测到可能重复的记录[/yellow]", expand=False))

    table = Table(show_header=True, header_style="bold")
    table.add_column("字段", style="cyan")
    table.add_column("当前记录")
    table.add_column("已有记录")

    fields = [
        ("文件名", "original_filename"),
        ("日期", "date"),
        ("供应商", "vendor"),
        ("金额", "amount"),
        ("发票号", "invoice_number"),
    ]

    for label, key in fields:
        current_val = str(record.get(key, "—"))
        existing_val = str(duplicate_of.get(key, "—"))
        table.add_row(label, current_val, existing_val)

    console.print(table)
    console.print()

    while True:
        choice = Prompt.ask(
            "此记录疑似已处理过。是否仍要纳入本次报销？",
            choices=["y", "n"],
            default="n",
        )
        if choice == "y":
            return "include"
        else:
            return "skip"


def handle_low_confidence_classification(
    record: dict,
    suggestions: list[dict],
) -> dict:
    """
    Show classification options when confidence is low and ask user to choose.
    Non-interactive mode: reads AUTO_CLASSIFY or SKIP_LOW_CONFIDENCE_REVIEW env vars.
    Returns the selected classification dict.
    """
    # Non-interactive mode: check SKIP_LOW_CONFIDENCE_REVIEW first
    skip_low_conf = os.environ.get("SKIP_LOW_CONFIDENCE_REVIEW", "false").lower() == "true"
    if skip_low_conf:
        logger.info(f"Skipping low-confidence classification (smoke test mode) for {record.get('original_filename')}")
        # Return the first suggestion or a default
        if suggestions:
            return suggestions[0]
        return {
            "category_l1": "其他",
            "category_l2": "其他",
            "category_l3": "",
            "confidence": "low",
            "reasoning": "Auto-skipped (smoke test mode)",
        }

    # Auto-accept first suggestion if AUTO_CLASSIFY is true
    env_auto_classify = os.environ.get("AUTO_CLASSIFY", "false").lower()
    if env_auto_classify == "true" and suggestions:
        logger.info(f"Auto-classifying (accepting first suggestion) for {record.get('original_filename')}")
        return suggestions[0]

    console.print()
    console.print(Panel(
        f"[yellow]费用分类置信度低：{record.get('original_filename', '')}[/yellow]",
        expand=False
    ))

    # Show record info
    console.print(f"  供应商: {record.get('vendor', '—')}")
    console.print(f"  描述: {record.get('description', '—')}")
    console.print(f"  金额: {record.get('amount', '—')} {record.get('currency', '')}")
    console.print()
    console.print("请从以下分类中选择：")
    console.print()

    table = Table(show_header=True, header_style="bold")
    table.add_column("序号", style="cyan", width=6)
    table.add_column("一级分类")
    table.add_column("二级分类")
    table.add_column("三级分类")
    table.add_column("置信度")
    table.add_column("理由", max_width=40)

    for idx, sug in enumerate(suggestions, 1):
        confidence_color = {
            "high": "green",
            "medium": "yellow",
            "low": "red",
        }.get(sug.get("confidence", "low"), "white")

        table.add_row(
            str(idx),
            sug.get("category_l1", ""),
            sug.get("category_l2", ""),
            sug.get("category_l3", ""),
            f"[{confidence_color}]{sug.get('confidence', 'low')}[/{confidence_color}]",
            sug.get("reasoning", ""),
        )

    # Add manual entry option
    table.add_row(
        str(len(suggestions) + 1),
        "手动输入",
        "", "", "", "自行输入分类信息",
    )

    console.print(table)
    console.print()

    while True:
        choice = _ask_with_default(
            "请选择（输入序号）",
            choices=valid_choices,
            default="1",
            env_var="CLASSIFICATION_CHOICE"
        )
        choice_idx = int(choice) - 1

        if choice_idx < len(suggestions):
            selected = suggestions[choice_idx]
        else:
            # Manual entry
            selected = _manual_classification_entry()

        return selected


def _manual_classification_entry() -> dict:
    """Prompt user to manually enter classification."""
    console.print()
    console.print("[bold]手动输入分类：[/bold]")
    l1 = Prompt.ask("一级分类（如：差旅费）").strip()
    l2 = Prompt.ask("二级分类（如：机票）").strip()
    l3 = Prompt.ask("三级分类（可为空，直接回车跳过）", default="").strip()

    return {
        "category_l1": l1,
        "category_l2": l2,
        "category_l3": l3,
        "confidence": "high",  # user confirmed
        "reasoning": "手动输入",
    }


def show_progress_bar(current: int, total: int, filename: str, prefix: str = "处理中") -> None:
    """Display a simple progress indicator."""
    pct = int(current / total * 100) if total > 0 else 0
    bar_len = 30
    filled = int(bar_len * current / total) if total > 0 else 0
    bar = "█" * filled + "░" * (bar_len - filled)
    console.print(
        f"\r[{bar}] {pct}% ({current}/{total}) {prefix}: {filename}",
        end="",
    )
    if current == total:
        console.print()


def show_processing_start(step: int, description: str) -> None:
    """Show start of a processing step."""
    console.print()
    console.print(f"[bold blue]Step {step}[/bold blue]  {description}")


def show_success(message: str) -> None:
    console.print(f"[green]✓ {message}[/green]")


def show_warning(message: str) -> None:
    console.print(f"[yellow]⚠ {message}[/yellow]")


def show_error(message: str) -> None:
    console.print(f"[red]✗ {message}[/red]")


def show_final_summary(
    person: str,
    year: int,
    month: str,
    records: list[dict],
    output_path: str,
    pending_path: Optional[str] = None,
    renamed_dir: Optional[str] = None,
) -> None:
    """Display a final summary of processed records."""
    console.print()
    console.print(Panel("[bold green]报销处理完成[/bold green]", expand=False))
    console.print()

    total = len(records)
    skipped = sum(1 for r in records if r.get("skipped"))
    processed = total - skipped
    pending = sum(1 for r in records if r.get("needs_review"))

    # Summary table
    table = Table(show_header=False, box=None)
    table.add_column("", style="cyan")
    table.add_column("")

    table.add_row("报销人", person)
    table.add_row("报销期间", f"{year}年{month}月")
    table.add_row("发票/账单数量", str(total))
    table.add_row("成功处理", str(processed))
    table.add_row("跳过（重复）", str(skipped))
    table.add_row("待确认", str(pending))

    # Total amounts by currency
    cny_total = sum(
        float(r.get("amount_cny", 0) or 0)
        for r in records
        if not r.get("skipped")
    )
    table.add_row("合计金额（CNY）", f"¥ {cny_total:,.2f}")

    console.print(table)
    console.print()
    console.print(f"[bold]输出文件：[/bold]")
    console.print(f"  报销报表: {output_path}")
    if pending_path and pending > 0:
        console.print(f"  待确认项: {pending_path}")
    if renamed_dir:
        console.print(f"  归档目录: {renamed_dir}")
    console.print()


def show_records_table(records: list[dict]) -> None:
    """Display extracted records in a table."""
    if not records:
        console.print("[yellow]无记录[/yellow]")
        return

    table = Table(show_header=True, header_style="bold", show_lines=True)
    table.add_column("#", width=4)
    table.add_column("文件名", max_width=25)
    table.add_column("日期", width=12)
    table.add_column("供应商", max_width=20)
    table.add_column("金额", width=12)
    table.add_column("货币", width=6)
    table.add_column("分类", max_width=20)
    table.add_column("状态", width=10)

    for idx, r in enumerate(records, 1):
        status = ""
        if r.get("skipped"):
            status = "[red]跳过[/red]"
        elif r.get("is_duplicate"):
            status = "[yellow]重复?[/yellow]"
        elif r.get("needs_review"):
            status = "[yellow]待确认[/yellow]"
        else:
            status = "[green]OK[/green]"

        cat = f"{r.get('category_l1', '')} / {r.get('category_l2', '')}"

        table.add_row(
            str(idx),
            r.get("original_filename", "")[:25],
            r.get("date", "—"),
            r.get("vendor", "—")[:20],
            str(r.get("amount", "—")),
            r.get("currency", "—"),
            cat[:20],
            status,
        )

    console.print(table)


def ask_continue_on_error(message: str) -> bool:
    """Ask user whether to continue after an error."""
    console.print(f"\n[red]错误: {message}[/red]")
    return Confirm.ask("是否仍要继续处理其余文件？", default=True)


def confirm_relearn(reason: str) -> bool:
    """Ask whether to re-run the learning step."""
    console.print(f"\n[yellow]{reason}[/yellow]")
    return Confirm.ask("是否重新学习格式和命名规则？", default=False)
