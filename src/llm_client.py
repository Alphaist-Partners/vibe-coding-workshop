"""llm_client.py

Light wrapper to use an OpenAI-compatible API (DeepSeek) and provide a
`client` object with `messages.create(...)` used by the existing code.

Reads credentials from environment variables loaded from `.env`:
- `DEEPSEEK_API_KEY` (preferred) or `OPENAI_API_KEY`
- optional `DEEPSEEK_API_BASE` to override OpenAI API base URL

This wrapper normalizes messages that may contain image blocks (base64)
by embedding a simple marker into the user content so the backend can
see the image payload. The project code expects `client.messages.create`
to return an object with `.content[0].text` holding the assistant text.
"""

from __future__ import annotations

import os
import base64
from dataclasses import dataclass
from typing import Any, List

from dotenv import load_dotenv

load_dotenv()

try:
    import openai
except Exception as e:
    raise ImportError("openai package is required. Install via `pip install openai`") from e

API_KEY = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY")
API_BASE = os.environ.get("DEEPSEEK_API_BASE")

if not API_KEY:
    # Do not fatal here; caller may handle missing key. But most callers expect a working client.
    pass

if API_BASE:
    openai.api_base = API_BASE

openai.api_key = API_KEY


@dataclass
class _ContentBlock:
    text: str


@dataclass
class _ClientMessages:
    _client: Any

    def create(self, *, model: str | None = None, max_tokens: int | None = None, messages: List[dict] | None = None):
        """Normalize messages and call OpenAI-compatible chat completion.

        Returns an object with `.content[0].text` for compatibility.
        """
        model = model or "gpt-4o"
        max_tokens = max_tokens or 1024

        if not messages:
            messages = []

        norm_msgs = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content")
            # Claude-style content can be a list of blocks (image/text). Convert to plain text.
            if isinstance(content, list):
                parts = []
                for block in content:
                    btype = block.get("type")
                    if btype == "text":
                        parts.append(block.get("text", ""))
                    elif btype == "image":
                        src = block.get("source", {})
                        if src.get("type") == "base64":
                            # Embed a compact marker containing the base64 image.
                            data = src.get("data", "")
                            parts.append(f"[IMAGE_BASE64:{data}]")
                        else:
                            parts.append("[IMAGE]")
                    else:
                        parts.append(str(block))
                content_str = "\n".join(parts)
            else:
                content_str = content if content is not None else ""

            norm_msgs.append({"role": role, "content": content_str})

        # Call OpenAI-compatible chat completion API
        try:
            resp = openai.ChatCompletion.create(model=model, messages=norm_msgs, max_tokens=max_tokens)
        except Exception as e:
            raise

        # Extract assistant text in a way tolerant to response formats
        text = ""
        try:
            choice = resp["choices"][0]
            if isinstance(choice.get("message"), dict):
                text = choice["message"].get("content", "")
            else:
                text = choice.get("text", "")
        except Exception:
            text = str(resp)

        class _Resp:
            def __init__(self, t: str):
                self.content = [_ContentBlock(t)]

        return _Resp(text)


class LLMClient:
    def __init__(self):
        self.messages = _ClientMessages(openai)


_GLOBAL_CLIENT: LLMClient | None = None


def get_client() -> LLMClient:
    global _GLOBAL_CLIENT
    if _GLOBAL_CLIENT is None:
        _GLOBAL_CLIENT = LLMClient()
    return _GLOBAL_CLIENT
