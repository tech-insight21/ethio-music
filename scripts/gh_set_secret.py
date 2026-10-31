#!/usr/bin/env python3
"""Set GitHub Actions secrets via the repo API (libsodium sealed box).

Usage: python3 scripts/gh_set_secret.py KEY value
Reads GH_USER/GH_REPO/GH_PAT from the environment.
"""
import base64
import json
import os
import sys
import urllib.request

import nacl.public  # pynacl


def api(method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    repo = os.environ["GH_REPO"]  # full slug: owner/name
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {os.environ['GH_PAT']}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "ethio-music-automation",
        },
    )
    with urllib.request.urlopen(req) as res:
        body = res.read().decode() or "{}"
        return res.status, json.loads(body)


def main() -> int:
    key, value = sys.argv[1], sys.argv[2]
    status, pk = api("GET", "actions/secrets/public-key")
    assert status == 200
    public_key = nacl.public.PublicKey(base64.b64decode(pk["key"]))
    sealed = nacl.public.SealedBox(public_key).encrypt(value.encode())
    status, _ = api("PUT", f"actions/secrets/{key}", {
        "encrypted_value": base64.b64encode(sealed).decode(),
        "key_id": pk["key_id"],
    })
    print(("OK   " if status in (201, 204) else f"FAIL {status} ") + key)
    return 0 if status in (201, 204) else 1


if __name__ == "__main__":
    sys.exit(main())
