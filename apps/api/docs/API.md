# ETHIO MUSIC API — Endpoint Reference

Base URL: `https://<host>/api/v1` · Auth: `Authorization: Bearer <access_token>`
Errors: `{ "error": { "code": "...", "message": "...", "details?": ... } }`

Pagination: `?limit=20&offset=0` → `pagination: { limit, offset, total, hasMore }`

## auth

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/telegram` | — | Mini App login with raw `initData` (official HMAC validation, 24 h freshness) |
| POST | `/auth/admin/login` | — | Staff password login → roles checked in `admin_roles` |
| POST | `/auth/refresh` | — | Rotate refresh token (old one invalidated) |
| POST | `/auth/logout` | JWT | Revoke the given refresh token server-side |
| GET | `/auth/me` | JWT | Profile + staff roles + premium entitlement |
| GET | `/auth/sessions` | JWT | Active sessions (never returns tokens) |
| DELETE | `/auth/sessions` | JWT | Revoke ALL sessions (global sign-out) |
| DELETE | `/auth/sessions/:id` | JWT | Revoke one session (ownership enforced) |

```bash
# Mini App login
curl -X POST https://host/api/v1/auth/telegram \
  -H 'Content-Type: application/json' \
  -d '{"initData":"query_id=...&user=...&auth_date=1730000000&hash=..."}'
# 200 {"session":{"access_token":"eyJ...","refresh_token":"t1...","user":{...}},
#      "profile":{"id":"...","username":"abebe","telegram_display_name":"Abebe"}}
# 401 {"error":{"code":"invalid_initdata","message":"initData verification failed: bad signature"}}
```

## users / favorites / playlists

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET/PATCH | `/users/me` | JWT | Profile read / self-update (username format enforced, 409 on clash) |
| GET/PUT | `/users/me/preferences` | JWT | `{notify_new_releases, notify_premium, notify_promotions, autoplay, data_saver}` |
| GET | `/users/me/activity` | JWT | Personal event trail |
| GET | `/users/me/follows` | JWT | Followed artists |
| POST/DELETE | `/users/me/follows/:artistId` | JWT | Idempotent (composite PK) |
| GET | `/favorites` | JWT | Favorited songs + embeds |
| PUT/DELETE | `/favorites/:songId` | JWT | Idempotent favorite/unfavorite |
| GET | `/playlists` | anon | Public lists (RLS-filtered), owner embed + song_count |
| GET | `/playlists/mine` | JWT | Own lists |
| POST | `/playlists` | JWT | Create (RLS binds owner) |
| GET | `/playlists/:id` | opt | Public or own (404 when hidden) |
| PATCH/DELETE | `/playlists/:id` | JWT | Owner only (403 when visible but foreign) |
| GET | `/playlists/:id/songs` | opt | Ordered tracks |
| POST/DELETE | `/playlists/:id/songs/:songId` | JWT | Append (position = max+1, duplicate → 409) / remove |
| PUT | `/playlists/:id/songs` | JWT | Reorder `{ "song_ids": [...] }` — one transaction |

## catalog (public + admin)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/songs?sort=popular\|newest&genre_id&language&artist_id&album_id` | anon | Approved only; embeds artist/album/genres |
| GET | `/songs/:idOrSlug` | opt | Public detail |
| POST | `/songs/:id/play` | opt | Records song_plays + analytics, atomic play_count |
| POST/PATCH/DELETE | `/songs` | staff `catalog:write` | Draft requires `rights_holder` |
| POST | `/songs/:id/approve` | staff | **License gate**: needs `licensed_at` + `license_document_url` |
| POST | `/songs/:id/takedown` | staff | Removes from public surface |
| POST | `/songs/:id/artwork` | staff | multipart `artwork` (png/jpeg/webp ≤ 5 MB) → Storage `covers` |
| POST | `/songs/:id/audio-url` | staff | Authoritative audio + license documents |
| GET | `/artists` `/artists/:idOrSlug` (+`/albums`,`/songs`) | anon | Approved artists, follower counts |
| POST | `/artists` | JWT | Self-registration → `pending` + auto-submission |
| POST | `/artists/:idOrSlug/submissions` | JWT | Owner re-submission |
| PATCH/DELETE | `/artists/:idOrSlug` | staff `artists:review` / `catalog:write` | Verify/approve/suspend |
| GET/POST/PATCH/DELETE | `/albums…` `/genres…` | anon / staff | Cached public reads |

## search & discovery

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/search?q=` | opt | Songs (two-query merge) + artists + albums + genres; records history |
| GET/DELETE | `/search/history` `/search/history/:id` | JWT | Own query log |
| GET | `/trending?window=7d\|30d\|all` | anon | `play_count + 5×plays_7d` weighting |
| GET | `/trending/artists` | anon | `monthly_listeners + 10×plays_30d` |
| GET | `/releases/new` | anon | By approval recency |
| GET | `/discover/recommendations` | opt | Genre affinity from favorites + plays; trending fallback |

## subscriptions & payments (Telegram Stars)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/subscriptions/plans` | anon | Active tiers incl. `price_stars` |
| GET | `/subscriptions/me` | JWT | Entitlement + history |
| POST | `/subscriptions/me/cancel` | JWT | Cancel; activation NEVER happens client-side |
| POST | `/payments/stars/invoice` | JWT | `{plan_id}` → `{payment_id, invoice_link, amount_stars}` (real `createInvoiceLink`) |
| POST | `/payments/promotions/:id/invoice` | JWT | `{amount_stars}` for a campaign draft |
| GET | `/payments` `/payments/:id` | JWT | Own receipts (admins see all) |
| POST | `/payments/:id/refund` | `finance:manage` | Bot API `refundStarPayment` + subscription revoke, audited |
| POST | `/telegram/webhook` | secret header | `pre_checkout_query` validation, `successful_payment` activation, chat registry, `/start` |

```bash
# after the user pays the Stars invoice, Telegram POSTs to the webhook:
# {"message":{"successful_payment":{"currency":"XTR","total_amount":250,
#   "invoice_payload":"<uuid>","telegram_payment_charge_id":"<id>"}}}
# → ONE transaction: payments pending→completed (provider_ref UNIQUE ⇒ replay-safe)
#   + subscription created/extended + receipt notification enqueued.
```

## promotions

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/promotions/active` | anon | Live campaigns (cached) |
| POST | `/promotions/:id/impression` `/click` | anon | 202 counters |
| GET | `/promotions/mine` | JWT | Campaigns of owned artists |
| POST | `/promotions/requests` | JWT | Artist owner → draft (≤ 90 days) |
| GET | `/admin/promotions` | `promotions:manage` | All campaigns + payment status |
| PATCH | `/admin/promotions/:id` | `promotions:manage` | Schedule/pause — **active requires completed payment** |
| GET | `/admin/promotions/:id/report` | `promotions:manage` | Impressions, clicks, CTR, payment |

## notifications

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/notifications?unread=true` | JWT | Inbox + unread_count |
| POST | `/notifications/:id/read` `/notifications/read-all` | JWT | Read state |
| DELETE | `/notifications/:id` | JWT | Remove |
| GET/PUT | `/notifications/telegram` | JWT | Chat link status + Telegram prefs |
| POST | `/admin/notifications/broadcast` `/send` | `notifications:send` | Fan-out to opted-in chats |

## analytics

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/analytics/events` | opt | Allowlisted types; anon only app_open/song_play/share |
| GET | `/analytics/overview` | `analytics:read` | Users, DAU/MAU, catalog, subscriptions, payments |
| GET | `/analytics/listeners` | `analytics:read` | 30-day activity + acquisition series |
| GET | `/analytics/content` | `analytics:read` | Top songs/artists/genres + search stats |
| GET | `/analytics/revenue` | `analytics:read` | Totals by provider/currency, daily series, conversions, promo stats |

## admin

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/admin/users` | `users:manage` | Directory + search + status filter |
| PUT | `/admin/users/:id/status` | `users:manage` | Suspend/reactivate (self protected; suspensions bite in ≤ 10 s) |
| GET | `/admin/admins` | `admins:manage` | Staff roster |
| POST | `/admin/admins` | `admins:manage` | Create staff account + role |
| PUT/DELETE | `/admin/admins/:userId/role` | `admins:manage` | Grant/change/revoke — **changing your own role is always 403** |
| GET/PATCH | `/admin/submissions` | `submissions:review` | Review queue; approval publishes the artist + notifies owner |
| GET | `/admin/audit-logs` | staff | Filterable trail (actor, action, entity) |
| GET/PUT | `/admin/settings` | staff / `settings:manage` | Platform configuration (maintenance mode, kill-switches) |
