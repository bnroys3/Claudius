import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Callable

from claude_client import call_claude
from github_tools import GITHUB_TOOLS

# -- Standard Python logger (writes to uvicorn console) -----------------------
logger = logging.getLogger("agentcrew")

MAX_ITERATIONS = 15  # Hard safety cap on orchestrator loops


# -- Log entry helpers ---------------------------------------------------------

def log_entry(kind: str, message: str, data: dict = None) -> dict:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind,   # run_start | decision | agent_start | agent_complete
                        # tool_call | tool_result | run_complete | error | warn
        "message": message,
    }
    if data:
        entry["data"] = data
    logger.info("[%s] %s %s", kind.upper(), message, json.dumps(data or {}))
    return entry


# -- Agent ---------------------------------------------------------------------

@dataclass
class Agent:
    id: str
    name: str
    role: str
    goal: str
    backstory: str
    is_orchestrator: bool = False
    model: str = "claude-sonnet-4-20250514"
    tools: list = field(default_factory=lambda: GITHUB_TOOLS)

    def run(self, task: str, context: str = "", on_log: Callable = None) -> str:
        system = (
            f"You are {self.name}, a {self.role}.\n\n"
            f"Your goal: {self.goal}\n\n"
            f"Background: {self.backstory}\n\n"
            "Use your tools when you need to interact with GitHub or the filesystem. "
            "Be thorough, precise, and complete your task fully."
        )
        user = f"## Your Task\n{task}"
        if context:
            user += f"\n\n## Context from Previous Work\n{context}"

        # Orchestrators delegate - they don't need tools
        tools = [] if self.is_orchestrator else self.tools
        return call_claude(system, user, tools, self.model, on_log=on_log)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "goal": self.goal,
            "backstory": self.backstory,
            "is_orchestrator": self.is_orchestrator,
            "model": self.model,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Agent":
        return cls(
            id=data["id"],
            name=data["name"],
            role=data["role"],
            goal=data["goal"],
            backstory=data["backstory"],
            is_orchestrator=data.get("is_orchestrator", False),
            model=data.get("model", "claude-sonnet-4-20250514"),
        )


# -- Work item -----------------------------------------------------------------

@dataclass
class WorkItem:
    id: str
    description: str
    status: str = "pending"   # pending | running | complete | failed
    result: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "description": self.description,
            "status": self.status,
            "result": self.result,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WorkItem":
        return cls(
            id=data["id"],
            description=data["description"],
            status=data.get("status", "pending"),
            result=data.get("result"),
        )


# -- Orchestrator crew ---------------------------------------------------------

class OrchestratorCrew:
    """
    Runs a work item by letting an orchestrator agent decide which worker
    agents to invoke, in what order, until the task is complete.
    """

    def __init__(self, orchestrator: Agent, workers: list[Agent]):
        self.orchestrator = orchestrator
        self.workers = {a.id: a for a in workers}

    def _orchestrator_prompts(self, work_item: str, context: str, iteration: int) -> tuple[str, str]:
        worker_descriptions = "\n".join(
            f'- id: "{a.id}" | name: {a.name} | role: {a.role} | goal: {a.goal}'
            for a in self.workers.values()
        )

        system = (
            f"You are {self.orchestrator.name}, an orchestrator agent.\n\n"
            f"Your goal: {self.orchestrator.goal}\n\n"
            f"Background: {self.orchestrator.backstory}\n\n"
            "You coordinate a team of specialist agents to complete work items. "
            "You never do the work yourself - you delegate to the right agent.\n\n"
            "Your available workers:\n"
            f"{worker_descriptions}\n\n"
            "At each step, review the work item and all context so far, then respond "
            "with ONLY a JSON object (no markdown, no explanation) in one of these two forms:\n\n"
            "To delegate to a worker:\n"
            '{"done": false, "next_agent_id": "<id>", '
            '"subtask": "<specific instructions for that agent>", '
            '"reasoning": "<why you chose this agent and what you expect>"}\n\n'
            "To declare the work complete:\n"
            '{"done": true, "summary": "<concise summary of everything accomplished>"}'
        )

        user = f"## Work Item\n{work_item}\n\n## Iteration\n{iteration} of {MAX_ITERATIONS}"
        if context:
            user += f"\n\n## Work Done So Far\n{context}"
        else:
            user += "\n\n## Work Done So Far\nNothing yet - this is the first step."

        return system, user

    def run(self, work_item: WorkItem, on_log: Callable[[dict], None] = None) -> dict:
        logs = []
        context = ""
        start_time = time.time()

        def emit(kind, message, data=None):
            entry = log_entry(kind, message, data)
            logs.append(entry)
            if on_log:
                on_log(entry)

        emit("run_start", f"Starting: {work_item.description[:80]}", {
            "work_item_id": work_item.id,
            "orchestrator": self.orchestrator.name,
            "workers": [a.name for a in self.workers.values()],
        })

        for iteration in range(1, MAX_ITERATIONS + 1):
            emit("decision", f"Orchestrator thinking - iteration {iteration}/{MAX_ITERATIONS}", {
                "iteration": iteration,
            })

            system, user = self._orchestrator_prompts(work_item.description, context, iteration)

            try:
                raw = call_claude(system, user, tools=[], model=self.orchestrator.model)
            except Exception as e:
                emit("error", f"Orchestrator API call failed: {e}")
                work_item.status = "failed"
                work_item.result = f"Orchestrator error: {e}"
                return {"status": "failed", "logs": logs, "result": work_item.result}

            # Parse orchestrator JSON
            try:
                clean = raw.strip().strip("```json").strip("```").strip()
                decision = json.loads(clean)
            except Exception:
                emit("error", "Orchestrator returned invalid JSON", {"raw": raw[:400]})
                work_item.status = "failed"
                work_item.result = "Orchestrator returned unparseable response."
                return {"status": "failed", "logs": logs, "result": work_item.result}

            # -- Done ----------------------------------------------------------
            if decision.get("done"):
                summary = decision.get("summary", "Work complete.")
                emit("run_complete", "Work declared complete by orchestrator", {
                    "summary": summary,
                    "total_iterations": iteration,
                    "elapsed_seconds": round(time.time() - start_time, 1),
                })
                work_item.status = "complete"
                work_item.result = summary
                return {"status": "complete", "logs": logs, "result": summary}

            # -- Delegate ------------------------------------------------------
            agent_id = decision.get("next_agent_id")
            subtask   = decision.get("subtask", "")
            reasoning = decision.get("reasoning", "")

            agent = self.workers.get(agent_id)
            if not agent:
                emit("warn", f"Orchestrator chose unknown agent '{agent_id}' - asking it to retry", {
                    "bad_id": agent_id,
                    "valid_ids": list(self.workers.keys()),
                })
                context += f"\n\n[SYSTEM] Iteration {iteration}: Unknown agent id '{agent_id}'. Valid ids: {list(self.workers.keys())}"
                continue

            emit("decision", f"Routing to {agent.name}: {subtask[:100]}", {
                "agent_name": agent.name,
                "agent_role": agent.role,
                "subtask": subtask,
                "reasoning": reasoning,
            })

            emit("agent_start", f"{agent.name} working...", {
                "agent_id": agent.id,
                "agent_name": agent.name,
                "model": agent.model,
            })

            agent_start = time.time()

            def agent_log(entry):
                logs.append(entry)
                if on_log:
                    on_log(entry)

            try:
                result = agent.run(subtask, context, on_log=agent_log)
                elapsed = round(time.time() - agent_start, 1)
                emit("agent_complete", f"{agent.name} finished in {elapsed}s", {
                    "agent_name": agent.name,
                    "elapsed_seconds": elapsed,
                    "result_preview": result[:300],
                })
                context += (
                    f"\n\n### Iteration {iteration} - {agent.name} ({agent.role})\n"
                    f"**Task:** {subtask}\n\n**Output:**\n{result}"
                )
            except Exception as e:
                elapsed = round(time.time() - agent_start, 1)
                emit("error", f"{agent.name} raised an exception after {elapsed}s", {
                    "agent_name": agent.name,
                    "error": str(e),
                })
                context += f"\n\n[SYSTEM] Iteration {iteration}: {agent.name} failed - {e}"

        # Hit iteration cap
        emit("warn", f"Reached max iterations ({MAX_ITERATIONS}) without completion", {
            "elapsed_seconds": round(time.time() - start_time, 1),
        })
        work_item.status = "failed"
        work_item.result = f"Stopped after {MAX_ITERATIONS} iterations without completion."
        return {"status": "failed", "logs": logs, "result": work_item.result}