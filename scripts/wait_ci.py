#!/usr/bin/env python3
"""Wait for CI workflows on a given commit and report conclusions."""
import json
import os
import sys
import time
import urllib.request

SHA = sys.argv[1] if len(sys.argv) > 1 else "00d9fc1"
REPO = "tech-insight21/ethio-music"
HDR = {"Authorization": f"Bearer {os.environ['GH_PAT']}", "Accept": "application/vnd.github+json"}


def get(url: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=30) as r:
        return json.load(r)


sha_full = None
for _ in range(15):
    runs = get(f"https://api.github.com/repos/{REPO}/actions/runs?head_sha={SHA}").get("workflow_runs", [])
    if runs:
        sha_full = runs[0]["head_sha"]
        break
    time.sleep(10)

if not sha_full:
    print("no runs found for", SHA)
    sys.exit(1)

print(f"waiting on workflows for {sha_full[:12]}")
for _ in range(80):
    runs = get(f"https://api.github.com/repos/{REPO}/actions/runs?head_sha={sha_full}").get("workflow_runs", [])
    status = {w["name"]: (w["status"], w["conclusion"]) for w in runs}
    names = {w["name"] for w in runs}
    done = len(runs) >= 3 and all(s == "completed" for s, _ in status.values())
    print(status, flush=True)
    if done:
        failures = {n: c for n, (s, c) in status.items() if c != "success"}
        print("RESULT:", "ALL GREEN" if not failures else f"FAILURES: {failures}")
        sys.exit(0 if not failures else 1)
    time.sleep(15)
print("timeout waiting for CI")
sys.exit(1)
