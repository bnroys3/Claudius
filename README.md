# Claudius

A lightweight, fully-owned multi-agent framework with a UI — just clean Python, Claude, and HTML.

## Structure

```
claudius/
  backend/
    main.py          # FastAPI server + REST API
    crew.py          # Agent, Task, Crew classes
    claude_client.py # Claude API wrapper with tool use
    github_tools.py  # GitHub + filesystem tools
  frontend/
    index.html       # Single-file UI
  requirements.txt
```

## Setup

**1. Install dependencies**
```bash
pip install -r requirements.txt
```

**2. Set environment variables**
```bash
export ANTHROPIC_API_KEY=your_key_here
export GITHUB_TOKEN=your_github_pat_here   # needs repo + pull_requests scope
```

**3. Start the backend**
```bash
cd backend
uvicorn main:app --reload --port 8000
```

**4. Open the UI**

Open `frontend/index.html` in your browser, or visit `http://localhost:8000` if you configure FastAPI to serve the static file.

## How it works

1. **Create agents** — give each one a name, role, goal, and backstory. Choose which Claude model to use per agent.
2. **Create tasks** — describe what needs to be done and assign it to an agent.
3. **Run the crew** — select tasks in order, hit Run. Each agent runs sequentially, and the output of each becomes context for the next.

## Available tools

Each agent has access to:
- `get_pr_diff` — read a PR's file diffs
- `post_pr_review` — post APPROVE / REQUEST_CHANGES / COMMENT
- `list_open_prs` — list all open PRs in a repo
- `get_file_contents` — read any file from a repo
- `commit_file` — create or update a file with a commit
- `create_branch` — create a new branch
- `create_pull_request` — open a PR
- `read_local_file` — read a local file
- `write_local_file` — write to a local file
- `run_command` — run shell commands (tests, linting, etc.)

## Example crew setup

| Agent | Role | Goal |
|-------|------|------|
| Alex | Senior Reviewer | Review PRs for bugs, security issues, and code quality |
| Sam | Developer | Fix issues identified in code review |
| Jordan | QA Engineer | Write and run tests to verify fixes |

**Tasks:**
1. `Alex` → "Review PR #42 in owner/repo and post a review"
2. `Sam` → "Fix the issues Alex identified in PR #42"
3. `Jordan` → "Run the test suite and report results"

## Adding your own tools

In `github_tools.py`, add a function and a schema entry to `GITHUB_TOOLS`, then register it in `register_all_tools()`. The tool dispatcher in `claude_client.py` will handle the rest.
