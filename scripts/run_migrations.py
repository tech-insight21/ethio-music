#!/usr/bin/env python3
"""
ETHIO MUSIC migration runner (repository copy).

Runs supabase/migrations/*.sql against the project database exactly once,
tracking applied versions in public.schema_migrations_local.

Env:
  SUPABASE_REF, SUPABASE_DB_PASSWORD, SUPABASE_POOLER_HOST (optional)

CI usage (GitHub Actions db-migrate workflow):
  python3 scripts/run_migrations.py
"""
import glob
import os
import sys

import psycopg2

HOST = os.environ.get("SUPABASE_POOLER_HOST", "aws-0-eu-west-1.pooler.supabase.com")
REF = os.environ["SUPABASE_REF"]
PWD = os.environ["SUPABASE_DB_PASSWORD"]
DIR = os.environ.get("MIGRATIONS_DIR", "supabase/migrations")
HISTORY = "public.schema_migrations_local"


def main() -> int:
    files = sorted(glob.glob(os.path.join(DIR, "*.sql")))
    if not files:
        print(f"ERROR: no .sql files in {DIR}")
        return 1

    conn = psycopg2.connect(
        host=HOST, port=5432, dbname="postgres",
        user=f"postgres.{REF}", password=PWD,
        sslmode="require", connect_timeout=30,
    )
    conn.autocommit = False
    failed = False

    with conn.cursor() as cur:
        cur.execute(
            f"""create table if not exists {HISTORY} (
                  version    text primary key,
                  name       text not null,
                  applied_at timestamptz not null default now())"""
        )
        conn.commit()

        cur.execute(f"select version from {HISTORY}")
        applied = {row[0] for row in cur.fetchall()}

        for path in files:
            name = os.path.basename(path)
            version = name.split("_")[0]
            if version in applied:
                print(f"SKIP  {name} (already applied)")
                continue
            sql = open(path, encoding="utf-8").read()
            try:
                cur.execute(sql)
                cur.execute(
                    f"insert into {HISTORY} (version, name) values (%s, %s)",
                    (version, name),
                )
                conn.commit()
                print(f"OK    {name}")
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                print(f"FAIL  {name}: {str(exc).strip()[:500]}")
                failed = True
                break

    conn.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
