#!/usr/bin/env python3
"""Verify bot_* tables exist, are RLS-protected, and anon PostgREST is denied."""
import os, json, urllib.request

import psycopg2

HOST = os.environ.get("SUPABASE_POOLER_HOST", "aws-0-eu-west-1.pooler.supabase.com")
REF = os.environ["SUPABASE_REF"]
PWD = os.environ["SUPABASE_DB_PASSWORD"]

conn = psycopg2.connect(
    host=HOST, port=5432, dbname="postgres",
    user=f"postgres.{REF}", password=PWD, sslmode="require", connect_timeout=15,
)
cur = conn.cursor()
cur.execute("""
    select c.relname, c.relrowsecurity,
           (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname like 'bot_%' and c.relkind='r'
    order by c.relname;
""")
rows = cur.fetchall()
print("bot tables (name, rls_enabled, anon_policies):")
for r in rows:
    print("  ", r)
assert len(rows) == 4, f"expected 4 bot tables, got {len(rows)}"
assert all(r[1] and r[2] == 0 for r in rows), "RLS must be on with 0 policies"

cur.execute("select count(*) from information_schema.triggers where trigger_name='trg_bot_chats_updated'")
assert cur.fetchone()[0] == 1

# anon PostgREST must be denied
url = f"https://{REF}.supabase.co/rest/v1/bot_chats?select=chat_id"
req = urllib.request.Request(url, headers={
    "apikey": os.environ["SUPABASE_ANON_KEY"],
    "Authorization": f"Bearer {os.environ['SUPABASE_ANON_KEY']}",
})
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode()
        print("anon read bot_chats ->", resp.status, body[:80])
        assert json.loads(body) == [], "anon read must return empty (RLS)"
except Exception as e:
    raise SystemExit(f"anon REST check failed: {e}")

conn.close()
print("VERIFY OK — bot tables live, RLS denies anon, triggers in place")
