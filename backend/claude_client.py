import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import anthropic

logger = logging.getLogger("agentcrew")
client = anthropic.Anthropic()
DEFAULT_MODEL = "claude-sonnet-4-20250514"

# ── Tool registry ─────────────────────────────────────────────────────────────

_tool_registry: dict[str, callable] = {}


def register_tool(name: str, fn: callable):
    _tool_registry[name] = fn


def dispatch_tool(name: str, inputs: dict) -> Any:
    if name in _tool_registry:
        try:
            return _tool_registry[name](**inputs)
        except Exception as e:
            logger.error("Tool %s failed: %s", name, e)
            return {"error": str(e)}
    logger.warning("Unknown tool called: %s", name)
    return {"error": f"Unknown tool: {name}"}


# ── Log helper ────────────────────────────────────────────────────────────────

def _log(on_log: Optional[Callable], kind: str, message: str, data: dict = None) -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "message": message,
    }
    if data:
        entry["data"] = data
    logger.info("[%s] %s %s", kind.upper(), message, json.dumps(data or {}))
    if on_log:
        on_log(entry)


# ── Main Claude call with tool loop ──────────────────────────────────────────

def call_claude(
    system: str,
    user: str,
    tools: list = [],
    model: str = DEFAULT_MODEL,
    on_log: Optional[Callable] = None,
) -> str:
    """
    Call Claude with optional tool use. Automatically handles the tool call
    loop until Claude returns a final text response.

    on_log: optional callback(entry) — called for every tool_call and tool_result.
    """
    messages = [{"role": "user", "content": user}]
    tool_round = 0

    while True:
        kwargs = {
            "model": model,
            "max_tokens": 4096,
            "system": system,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools

        response = client.messages.create(**kwargs)

        if response.stop_reason == "tool_use":
            tool_round += 1
            tool_results = []
            assistant_content = response.content

            for block in response.content:
                if block.type == "tool_use":
                    _log(on_log, "tool_call", f"→ {block.name}()", {
                        "tool": block.name,
                        "inputs": block.input,
                        "round": tool_round,
                    })

                    result = dispatch_tool(block.name, block.input)

                    _log(on_log, "tool_result", f"← {block.name} returned", {
                        "tool": block.name,
                        "result_preview": str(result)[:300],
                        "round": tool_round,
                    })

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    })

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

        else:
            # Final text response
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text
            return ""