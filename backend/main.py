import os
import json
import uuid
import asyncio
import logging
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from crew import Agent, WorkItem, OrchestratorCrew
from github_tools import register_all_tools

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("agentcrew")

# Register all GitHub + filesystem tools at startup
register_all_tools()

app = FastAPI(title="AgentCrew API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = Path("data.json")


# -- Health check -------------------------------------------------------------

@app.get("/health")
def health():
    issues = []
    if not os.environ.get("ANTHROPIC_API_KEY"):
        issues.append("ANTHROPIC_API_KEY is not set")
    if not os.environ.get("GITHUB_TOKEN"):
        issues.append("GITHUB_TOKEN is not set")
    return {
        "ok": len(issues) == 0,
        "issues": issues,
        "env": {
            "anthropic_api_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "github_token": bool(os.environ.get("GITHUB_TOKEN")),
        }
    }


# ── Persistence ───────────────────────────────────────────────────────────────

def load_data() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return {"agents": [], "work_items": [], "runs": []}


def save_data(data: dict):
    DATA_FILE.write_text(json.dumps(data, indent=2))


# ── Pydantic models ───────────────────────────────────────────────────────────

class AgentCreate(BaseModel):
    name: str
    role: str
    goal: str
    backstory: str
    is_orchestrator: bool = False
    model: str = "claude-sonnet-4-20250514"


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    goal: Optional[str] = None
    backstory: Optional[str] = None
    is_orchestrator: Optional[bool] = None
    model: Optional[str] = None


class WorkItemCreate(BaseModel):
    description: str


class RunCreate(BaseModel):
    work_item_id: str
    orchestrator_id: str


# ── Agent endpoints ───────────────────────────────────────────────────────────

@app.get("/agents")
def list_agents():
    return load_data()["agents"]


@app.post("/agents")
def create_agent(body: AgentCreate):
    data = load_data()
    agent = {"id": str(uuid.uuid4()), **body.model_dump()}
    data["agents"].append(agent)
    save_data(data)
    logger.info("Created agent: %s (%s)", agent["name"], agent["id"])
    return agent


@app.put("/agents/{agent_id}")
def update_agent(agent_id: str, body: AgentUpdate):
    data = load_data()
    for i, a in enumerate(data["agents"]):
        if a["id"] == agent_id:
            updates = {k: v for k, v in body.model_dump().items() if v is not None}
            data["agents"][i] = {**a, **updates}
            save_data(data)
            logger.info("Updated agent: %s", agent_id)
            return data["agents"][i]
    raise HTTPException(status_code=404, detail="Agent not found")


@app.delete("/agents/{agent_id}")
def delete_agent(agent_id: str):
    data = load_data()
    data["agents"] = [a for a in data["agents"] if a["id"] != agent_id]
    save_data(data)
    logger.info("Deleted agent: %s", agent_id)
    return {"deleted": agent_id}


# ── Work item endpoints ───────────────────────────────────────────────────────

@app.get("/work-items")
def list_work_items():
    return load_data()["work_items"]


@app.post("/work-items")
def create_work_item(body: WorkItemCreate):
    data = load_data()
    item = {
        "id": str(uuid.uuid4()),
        "description": body.description,
        "status": "pending",
        "result": None,
    }
    data["work_items"].append(item)
    save_data(data)
    logger.info("Created work item: %s", item["id"])
    return item


@app.delete("/work-items/{item_id}")
def delete_work_item(item_id: str):
    data = load_data()
    data["work_items"] = [w for w in data["work_items"] if w["id"] != item_id]
    save_data(data)
    return {"deleted": item_id}


# ── Run endpoints ─────────────────────────────────────────────────────────────

@app.get("/runs")
def list_runs():
    return load_data()["runs"]


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    data = load_data()
    for r in data["runs"]:
        if r["id"] == run_id:
            return r
    raise HTTPException(status_code=404, detail="Run not found")


@app.post("/runs")
async def create_run(body: RunCreate):
    data = load_data()

    # Validate work item
    work_item_data = next((w for w in data["work_items"] if w["id"] == body.work_item_id), None)
    if not work_item_data:
        raise HTTPException(status_code=404, detail="Work item not found")

    # Validate orchestrator
    orch_data = next((a for a in data["agents"] if a["id"] == body.orchestrator_id), None)
    if not orch_data:
        raise HTTPException(status_code=404, detail="Orchestrator agent not found")
    if not orch_data.get("is_orchestrator"):
        raise HTTPException(status_code=400, detail="Specified agent is not marked as an orchestrator")

    # Workers = all non-orchestrator agents
    workers = [Agent.from_dict(a) for a in data["agents"] if not a.get("is_orchestrator")]
    if not workers:
        raise HTTPException(status_code=400, detail="No worker agents defined")

    orchestrator = Agent.from_dict(orch_data)
    work_item = WorkItem.from_dict(work_item_data)

    run_id = str(uuid.uuid4())
    run_record = {
        "id": run_id,
        "work_item_id": body.work_item_id,
        "work_item_description": work_item.description,
        "orchestrator_name": orchestrator.name,
        "status": "running",
        "result": None,
        "logs": [],
    }
    data["runs"].append(run_record)
    # Mark work item as running
    for i, w in enumerate(data["work_items"]):
        if w["id"] == body.work_item_id:
            data["work_items"][i]["status"] = "running"
    save_data(data)

    logger.info("Run %s started — work item: %s | orchestrator: %s",
                run_id, work_item.id, orchestrator.name)

    def on_log(entry: dict):
        """Append log entry to run record in real time."""
        d = load_data()
        for i, r in enumerate(d["runs"]):
            if r["id"] == run_id:
                d["runs"][i]["logs"].append(entry)
                break
        save_data(d)

    crew = OrchestratorCrew(orchestrator, workers)

    loop = asyncio.get_event_loop()
    run_result = await loop.run_in_executor(
        None, lambda: crew.run(work_item, on_log=on_log)
    )

    # Finalize
    d = load_data()
    for i, r in enumerate(d["runs"]):
        if r["id"] == run_id:
            d["runs"][i]["status"] = run_result["status"]
            d["runs"][i]["result"] = run_result["result"]
            d["runs"][i]["logs"] = run_result["logs"]
            break
    for i, w in enumerate(d["work_items"]):
        if w["id"] == body.work_item_id:
            d["work_items"][i]["status"] = run_result["status"]
            d["work_items"][i]["result"] = run_result["result"]
    save_data(d)

    logger.info("Run %s finished — status: %s", run_id, run_result["status"])
    return {"run_id": run_id, **run_result}


# ── Serve frontend ────────────────────────────────────────────────────────────

@app.get("/")
def serve_frontend():
    return FileResponse("../frontend/index.html")