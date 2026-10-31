#!/usr/bin/env python3
"""Verify the 20260105000000_backend_api migration landed on the live DB."""
import os
import sys

import psycopg2

HOST = os.environ.get("SUPABASE_POOLER_HOST", "aws-0-eu-west-1.pooler.supabase.com")
REF = os.environ["SUPABASE_REF"]
PWD = os.environ["SUPABASE_DB_PASSWORD"]

TABLES = ["user_sessions", "audit_logs", "platform_settings", "search_history",
          "analytics_events", "artist_submissions", "job_runs"]

CHECKS = [
    ("payments", "amount_stars"), ("payments", "payload"), ("payments", "plan_id"),
    ("notifications", "status"), ("notifications", "dedup_key"), ("notifications", "send_at"),
    ("bot_chats", "user_id"), ("plans", "price_stars"), ("songs", "language"),
]

conn = psycopg2.connect(host=HOST, port=5432, dbname="postgres",
                        user=f"postgres.{REF}", password=PWD,
                        sslmode="require", connect_timeout=30)
ok = True
with conn.cursor() as cur:
    for t in TABLES:
        cur.execute("select 1 from information_schema.tables where table_schema='public' and table_name=%s", (t,))
        if cur.fetchone():
            print(f"OK    table {t}")
        else:
            ok = False
            print(f"MISS  table {t}")
    for t, c in CHECKS:
        cur.execute("select 1 from information_schema.columns where table_schema='public' and table_name=%s and column_name=%s", (t, c))
        if cur.fetchone():
            print(f"OK    {t}.{c}")
        else:
            ok = False
            print(f"MISS  {t}.{c}")
    cur.execute("select unnest(enum_range(NULL::public.payment_provider))")
    vals = {r[0] for r in cur.fetchall()}
    print(("OK    " if "telegram_stars" in vals else "MISS  ") + f"payment_provider values: {sorted(vals)}")
    if "telegram_stars" not in vals:
        ok = False
    cur.execute("select key from public.platform_settings")
    print("OK    platform_settings rows:", sorted(r[0] for r in cur.fetchall()))
    cur.execute("select code, price_stars from public.plans order by sort_order")
    print("OK    plans:", cur.fetchall())
conn.close()
sys.exit(0 if ok else 1)
