"""
Claudeius quickstart — assumes:
  - npm packages already installed (frontend/node_modules exists)
  - TypeScript already compiled (frontend/js/*.js files exist)

Use start.py for a full startup that compiles TS and installs packages.
"""

import os
import sys
import time
import webbrowser
import subprocess
import urllib.request
from pathlib import Path

PORT     = 8000
URL      = f"http://localhost:{PORT}"
HERE     = Path(__file__).parent
IS_WINDOWS = sys.platform == "win32"


def check_env():
    missing = [v for v in ("ANTHROPIC_API_KEY", "GITHUB_TOKEN") if not os.environ.get(v)]
    if missing:
        print("WARNING: missing environment variables:")
        for m in missing:
            print(f"  {'set' if IS_WINDOWS else 'export'} {m}=your_value_here")
        print()


def wait_for_server(timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(URL + "/health", timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


check_env()
print(f"Starting Claudeius on {URL} ...")

proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "main:app", "--port", str(PORT), "--reload"],
    cwd=str(HERE / "backend"),
)

if wait_for_server():
    print("Ready! Opening browser...\n")
    webbrowser.open(URL)
else:
    print(f"Server slow to start - open {URL} manually.\n")

print("Press Ctrl+C to stop.\n")
try:
    proc.wait()
except KeyboardInterrupt:
    print("\nStopping...")
    proc.terminate()
    proc.wait()
    print("Done.")
except Exception as e:
    print(f"\nError: {e}")
    proc.terminate()