-- ============================================================================
-- ETHIO MUSIC :: 0001 — Extensions
-- Enables UUID generation and trigram fuzzy-search support.
-- Idempotent: safe to run multiple times.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- fuzzy text search on titles/names
