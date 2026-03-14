import os
import base64
import subprocess
from github import Github
from claude_client import register_tool

_github_client = None


def get_github_client() -> Github:
    global _github_client
    if _github_client is None:
        token = os.environ.get("GITHUB_TOKEN")
        if not token:
            raise ValueError("GITHUB_TOKEN environment variable not set")
        _github_client = Github(token)
    return _github_client


# ── PR tools ──────────────────────────────────────────────────────────────────

def get_pr_diff(repo: str, pr_number: int) -> dict:
    """Get the file diffs for a pull request."""
    g = get_github_client()
    repo_obj = g.get_repo(repo)
    pr = repo_obj.get_pull(pr_number)
    files = []
    for f in pr.get_files():
        files.append({
            "filename": f.filename,
            "status": f.status,
            "additions": f.additions,
            "deletions": f.deletions,
            "patch": f.patch or "",
        })
    return {
        "title": pr.title,
        "description": pr.body or "",
        "files": files,
    }


def post_pr_review(repo: str, pr_number: int, comment: str, decision: str) -> dict:
    """Post a review on a pull request. Decision: APPROVE, REQUEST_CHANGES, or COMMENT."""
    g = get_github_client()
    repo_obj = g.get_repo(repo)
    pr = repo_obj.get_pull(pr_number)
    review = pr.create_review(body=comment, event=decision)
    return {"review_id": review.id, "state": review.state}


def list_open_prs(repo: str) -> dict:
    """List all open pull requests in a repo."""
    g = get_github_client()
    repo_obj = g.get_repo(repo)
    prs = []
    for pr in repo_obj.get_pulls(state="open"):
        prs.append({
            "number": pr.number,
            "title": pr.title,
            "author": pr.user.login,
            "created_at": pr.created_at.isoformat(),
            "url": pr.html_url,
        })
    return {"pull_requests": prs}


# ── File / commit tools ───────────────────────────────────────────────────────

def get_file_contents(repo: str, path: str, branch: str = "main") -> dict:
    """Read a file from a GitHub repo."""
    g = get_github_client()
    repo_obj = g.get_repo(repo)
    file_obj = repo_obj.get_contents(path, ref=branch)
    content = base64.b64decode(file_obj.content).decode("utf-8")
    return {"path": path, "content": content, "sha": file_obj.sha}


def commit_file(repo: str, path: str, content: str, message: str, branch: str = "main") -> dict:
    """Create or update a file in a GitHub repo."""
    g = get_github_client()
    repo_obj = g.get_repo(repo)
    try:
        existing = repo_obj.get_contents(path, ref=branch)
        result = repo_obj.update_file(path, message, content, existing.sha, branch=branch)
    except Exception:
        result = repo_obj.create_file(path, message, content, branch=branch)
    return {"commit_sha": result["commit"].sha, "path": path}


def create_branch(repo: str, branch_name: str, from_branch: str = "main") -> dict:
    """Create a new branch in a repo."""
    g = get_github_client()
    repo_obj = g.get_repo(repo)
    source = repo_obj.get_branch(from_branch)
    repo_obj.create_git_ref(f"refs/heads/{branch_name}", source.commit.sha)
    return {"branch": branch_name, "from": from_branch}


def create_pull_request(repo: str, title: str, body: str, head: str, base: str = "main") -> dict:
    """Create a pull request."""
    g = get_github_client()
    repo_obj = g.get_repo(repo)
    pr = repo_obj.create_pull(title=title, body=body, head=head, base=base)
    return {"pr_number": pr.number, "url": pr.html_url}


# ── Filesystem / local tools ──────────────────────────────────────────────────

def read_local_file(path: str) -> dict:
    """Read a local file."""
    with open(path, "r") as f:
        return {"path": path, "content": f.read()}


def write_local_file(path: str, content: str) -> dict:
    """Write content to a local file. Path must be inside workspace/ folder."""
    import os
    from pathlib import Path
    # Enforce workspace/ prefix - prevent agents writing outside their sandbox
    safe_path = path.lstrip("/\\")
    if not safe_path.startswith("workspace/") and not safe_path.startswith("workspace\\"):
        safe_path = "workspace/" + safe_path
    # Create parent directories if needed
    Path(safe_path).parent.mkdir(parents=True, exist_ok=True)
    with open(safe_path, "w", encoding="utf-8") as f:
        f.write(content)
    return {"path": safe_path, "status": "written"}


def run_command(command: str, cwd: str = ".") -> dict:
    """Run a shell command (e.g. tests, linting)."""
    result = subprocess.run(
        command, shell=True, capture_output=True, text=True, cwd=cwd, timeout=60
    )
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode,
    }


# ── Tool schemas (for Claude) ─────────────────────────────────────────────────

GITHUB_TOOLS = [
    {
        "name": "get_pr_diff",
        "description": "Get the file diffs and metadata for a GitHub pull request",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string", "description": "owner/repo format"},
                "pr_number": {"type": "integer"},
            },
            "required": ["repo", "pr_number"],
        },
    },
    {
        "name": "post_pr_review",
        "description": "Post a review comment on a GitHub pull request",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "pr_number": {"type": "integer"},
                "comment": {"type": "string"},
                "decision": {"type": "string", "enum": ["APPROVE", "REQUEST_CHANGES", "COMMENT"]},
            },
            "required": ["repo", "pr_number", "comment", "decision"],
        },
    },
    {
        "name": "list_open_prs",
        "description": "List all open pull requests in a GitHub repo",
        "input_schema": {
            "type": "object",
            "properties": {"repo": {"type": "string"}},
            "required": ["repo"],
        },
    },
    {
        "name": "get_file_contents",
        "description": "Read a file from a GitHub repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "path": {"type": "string"},
                "branch": {"type": "string", "default": "main"},
            },
            "required": ["repo", "path"],
        },
    },
    {
        "name": "commit_file",
        "description": "Create or update a file in a GitHub repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "path": {"type": "string"},
                "content": {"type": "string"},
                "message": {"type": "string"},
                "branch": {"type": "string", "default": "main"},
            },
            "required": ["repo", "path", "content", "message"],
        },
    },
    {
        "name": "create_branch",
        "description": "Create a new git branch in a repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "branch_name": {"type": "string"},
                "from_branch": {"type": "string", "default": "main"},
            },
            "required": ["repo", "branch_name"],
        },
    },
    {
        "name": "create_pull_request",
        "description": "Create a pull request in a GitHub repository",
        "input_schema": {
            "type": "object",
            "properties": {
                "repo": {"type": "string"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "head": {"type": "string"},
                "base": {"type": "string", "default": "main"},
            },
            "required": ["repo", "title", "body", "head"],
        },
    },
    {
        "name": "read_local_file",
        "description": "Read a file from the local filesystem. Use workspace/ prefix for project files.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "write_local_file",
        "description": "Write content to a local file. Always use workspace/ as the root folder for all project files.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "run_command",
        "description": "Run a shell command such as tests or linting",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "cwd": {"type": "string", "default": "."},
            },
            "required": ["command"],
        },
    },
]


def register_all_tools():
    """Register all GitHub and filesystem tools with the dispatcher."""
    register_tool("get_pr_diff", get_pr_diff)
    register_tool("post_pr_review", post_pr_review)
    register_tool("list_open_prs", list_open_prs)
    register_tool("get_file_contents", get_file_contents)
    register_tool("commit_file", commit_file)
    register_tool("create_branch", create_branch)
    register_tool("create_pull_request", create_pull_request)
    register_tool("read_local_file", read_local_file)
    register_tool("write_local_file", write_local_file)
    register_tool("run_command", run_command)
