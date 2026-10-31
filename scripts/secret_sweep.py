#!/usr/bin/env python3
"""Safety sweep: ensure no secret VALUE from the private env file appears in
any file that is about to be committed. Prints only file:line hits (never the
secret itself)."""
import os
import re
import sys

ENV = "/home/z/my-project/.secrets/env.sh"
REPO = "/home/z/my-project/ethio-music"

secrets = {}
with open(ENV) as f:
    for line in f:
        m = re.match(r"^export ([A-Z_0-9]+)=(.*)$", line.strip())
        if not m:
            continue
        name, val = m.group(1), m.group(2).strip().strip('"').strip("'")
        # Public-by-design identifiers and values — safe to appear in the repo:
        #   project ref, project URL, pooler host, anon/publishable key
        #   (RLS-protected and shipped inside the public TMA bundle), bot handle.
        PUBLIC_VARS = {
            "GH_USER", "GH_REPO", "SUPABASE_REF", "SUPABASE_URL",
            "SUPABASE_POOLER_HOST", "SUPABASE_ANON_KEY",
            "SUPABASE_PUBLISHABLE_KEY", "TG_BOT_USERNAME",
        }
        if name in PUBLIC_VARS:
            continue
        if val and len(val) >= 8:
            secrets[name] = val

hits = []
skip_dirs = {"node_modules", ".git", ".next", "out", "dist"}
for root, dirs, files in os.walk(REPO):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for fn in files:
        p = os.path.join(root, fn)
        try:
            with open(p, encoding="utf-8", errors="ignore") as f:
                for i, line in enumerate(f, 1):
                    for name, val in secrets.items():
                        if val in line:
                            hits.append((os.path.relpath(p, REPO), i, name))
        except OSError:
            pass

if hits:
    for h in hits:
        print("LEAK:", h)
    sys.exit(1)
print(f"No secret values found in repo (checked {len(secrets)} secrets). Safe to commit.")
