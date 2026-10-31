-- ============================================================================
-- ETHIO MUSIC :: 0004 — Seed data (FICTIONAL)
--   All artists, albums, songs and license references below are invented
--   for development/demo purposes. Audio URLs point at the `tracks` storage
--   bucket — replace with real files when catalog content is onboarded.
--   Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Genres
-- ---------------------------------------------------------------------------
insert into public.genres (id, name, slug, description) values
  ('f0000000-0000-4000-8000-00000000a001','Ethio-Jazz','ethio-jazz','Fusion of jazz with Ethiopian pentatonic scales (qenet).'),
  ('f0000000-0000-4000-8000-00000000a002','Amharic Pop','amharic-pop','Modern Amharic-language pop.'),
  ('f0000000-0000-4000-8000-00000000a003','Oromo Pop','oromo-pop','Contemporary Oromo-language pop.'),
  ('f0000000-0000-4000-8000-00000000a004','Tigrigna Traditional','tigrigna-traditional','Traditional Tigray styles and dance rhythms.'),
  ('f0000000-0000-4000-8000-00000000a005','Azmari','azmari','Wit and social commentary over masenqo & krar.'),
  ('f0000000-0000-4000-8000-00000000a006','Ethio-Reggae','ethio-reggae','Reggae rooted in Ethiopian groove.'),
  ('f0000000-0000-4000-8000-00000000a007','Guragigna Folk','guragigna-folk','Upbeat Gurage folk rhythms.'),
  ('f0000000-0000-4000-8000-00000000a008','Instrumental','instrumental','Instrumental and cinematic pieces.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Artists (fictional)
-- ---------------------------------------------------------------------------
insert into public.artists (id, name, slug, bio, country, region, verified, status, monthly_listeners) values
  ('f0000000-0000-4000-8000-00000000aa01','Abebe Bekele','abebe-bekele',
   'Fictional Ethio-jazz keyboardist blending Addis brass with modern production.',
   'ET','Addis Ababa', true,  'approved', 48200),
  ('f0000000-0000-4000-8000-00000000aa02','Tigist Alemu','tigist-alemu',
   'Fictional Amharic pop vocalist known for Tizita-inspired ballads.',
   'ET','Addis Ababa', true,  'approved', 91300),
  ('f0000000-0000-4000-8000-00000000aa03','Dawit Girma','dawit-girma',
   'Fictional Oromo pop singer from Adama mixing Afan Oromo lyrics with EDM.',
   'ET','Oromia',      false, 'approved', 37500),
  ('f0000000-0000-4000-8000-00000000aa04','Hanna Tesfaye','hanna-tesfaye',
   'Fictional Tigrigna traditional singer from Mekelle.',
   'ET','Tigray',      false, 'approved', 21400),
  ('f0000000-0000-4000-8000-00000000aa05','Yonas Haile','yonas-haile',
   'Fictional Ethio-reggae artist rooted in roots reggae and Ethiopian groove.',
   'ET','Addis Ababa', false, 'approved', 18900),
  ('f0000000-0000-4000-8000-00000000aa06','Selam Worku','selam-worku',
   'Fictional azmari performer from Gondar carrying the masenqo tradition.',
   'ET','Amhara',      false, 'approved', 12700)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Albums (fictional)
-- ---------------------------------------------------------------------------
insert into public.albums (id, artist_id, title, slug, album_type, release_date, description) values
  ('f0000000-0000-4000-8000-00000000ab01','f0000000-0000-4000-8000-00000000aa01','Addis After Dark','addis-after-dark','album','2024-03-01','Fictional late-night Ethio-jazz sessions.'),
  ('f0000000-0000-4000-8000-00000000ab02','f0000000-0000-4000-8000-00000000aa02','Tizita Lene','tizita-lene','album','2025-01-15','Fictional ballad collection in Tizita mode.'),
  ('f0000000-0000-4000-8000-00000000ab03','f0000000-0000-4000-8000-00000000aa03','Finfinne Nights','finfinne-nights','ep','2025-06-20','Fictional Oromo pop EP.'),
  ('f0000000-0000-4000-8000-00000000ab04','f0000000-0000-4000-8000-00000000aa04','Kzeba Fikri','keza-fikri','album','2024-09-10','Fictional Tigrigna traditional recordings.'),
  ('f0000000-0000-4000-8000-00000000ab05','f0000000-0000-4000-8000-00000000aa05','Positive Vibes','positive-vibes','album','2023-11-05','Fictional roots-reggae set.'),
  ('f0000000-0000-4000-8000-00000000ab06','f0000000-0000-4000-8000-00000000aa06','Wello Wedi','wello-wedi','ep','2024-05-18','Fictional azmari live session.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Songs (fictional, approved ⇒ license fields are mandatory & populated)
-- ---------------------------------------------------------------------------
insert into public.songs (
  id, artist_id, album_id, title, slug, audio_url, duration_seconds,
  track_number, isrc, license_type, rights_holder, license_document_url,
  distribution_agreement_url, licensed_at, license_expires_at, release_status,
  approved_at, play_count
) values
  ('f0000000-0000-4000-8000-00000000ac01',
   'f0000000-0000-4000-8000-00000000aa01','f0000000-0000-4000-8000-00000000ab01',
   'Tezeta Gar','tezeta-gar',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/abebe-bekele/tezeta-gar.mp3',
   287, 1, 'ET0002400001','licensed_master','Addis Sound Records (fictional)',
   '/legal/seed/abr-asr-master-license.pdf','/legal/seed/asr-distribution-agreement.pdf',
   '2024-02-01T09:00:00Z','2027-02-01T00:00:00Z','approved','2024-02-10T09:00:00Z', 15230),
  ('f0000000-0000-4000-8000-00000000ac02',
   'f0000000-0000-4000-8000-00000000aa01','f0000000-0000-4000-8000-00000000ab01',
   'Addis After Dark','addis-after-dark-song',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/abebe-bekele/addis-after-dark.mp3',
   341, 2, 'ET0002400002','licensed_master','Addis Sound Records (fictional)',
   '/legal/seed/abr-asr-master-license.pdf','/legal/seed/asr-distribution-agreement.pdf',
   '2024-02-01T09:00:00Z','2027-02-01T00:00:00Z','approved','2024-02-10T09:00:00Z', 9870),
  ('f0000000-0000-4000-8000-00000000ac03',
   'f0000000-0000-4000-8000-00000000aa02','f0000000-0000-4000-8000-00000000ab02',
   'Tizita Lene','tizita-lene-song',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/tigist-alemu/tizita-lene.mp3',
   258, 1, 'ET0002500001','distribution_deal','Sheba Music Distributors (fictional)',
   '/legal/seed/ta-smd-master-license.pdf','/legal/seed/smd-distribution-agreement.pdf',
   '2025-01-02T09:00:00Z','2028-01-02T00:00:00Z','approved','2025-01-10T09:00:00Z', 41200),
  ('f0000000-0000-4000-8000-00000000ac04',
   'f0000000-0000-4000-8000-00000000aa02','f0000000-0000-4000-8000-00000000ab02',
   'Yene Konjo','yene-konjo',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/tigist-alemu/yene-konjo.mp3',
   244, 2, 'ET0002500002','distribution_deal','Sheba Music Distributors (fictional)',
   '/legal/seed/ta-smd-master-license.pdf','/legal/seed/smd-distribution-agreement.pdf',
   '2025-01-02T09:00:00Z','2028-01-02T00:00:00Z','approved','2025-01-10T09:00:00Z', 33580),
  ('f0000000-0000-4000-8000-00000000ac05',
   'f0000000-0000-4000-8000-00000000aa03','f0000000-0000-4000-8000-00000000ab03',
   'Finfinne Nights','finfinne-nights-song',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/dawit-girma/finfinne-nights.mp3',
   275, 1, 'ET0002500003','owned_master','Dawit Girma (fictional self-release)',
   '/legal/seed/dg-master-license.pdf','/legal/seed/dg-ethio-music-agreement.pdf',
   '2025-06-01T09:00:00Z','2028-06-01T00:00:00Z','approved','2025-06-15T09:00:00Z', 20450),
  ('f0000000-0000-4000-8000-00000000ac06',
   'f0000000-0000-4000-8000-00000000aa03','f0000000-0000-4000-8000-00000000ab03',
   'Gammachuu','gammachuu',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/dawit-girma/gammachuu.mp3',
   231, 2, 'ET0002500004','owned_master','Dawit Girma (fictional self-release)',
   '/legal/seed/dg-master-license.pdf','/legal/seed/dg-ethio-music-agreement.pdf',
   '2025-06-01T09:00:00Z','2028-06-01T00:00:00Z','approved','2025-06-15T09:00:00Z', 17320),
  ('f0000000-0000-4000-8000-00000000ac07',
   'f0000000-0000-4000-8000-00000000aa04','f0000000-0000-4000-8000-00000000ab04',
   'Kzeba Fikri','keza-fikri-song',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/hanna-tesfaye/keza-fikri.mp3',
   302, 1, 'ET0002400003','licensed_master','Tigray Tunes PLC (fictional)',
   '/legal/seed/ht-tt-master-license.pdf','/legal/seed/tt-distribution-agreement.pdf',
   '2024-08-15T09:00:00Z','2027-08-15T00:00:00Z','approved','2024-09-01T09:00:00Z', 8940),
  ('f0000000-0000-4000-8000-00000000ac08',
   'f0000000-0000-4000-8000-00000000aa05','f0000000-0000-4000-8000-00000000ab05',
   'Positive Vibes','positive-vibes-song',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/yonas-haile/positive-vibes.mp3',
   289, 1, 'ET0002300001','creative_commons','Yonas Haile (fictional, CC BY-NC 4.0)',
   '/legal/seed/yh-cc-certificate.pdf','/legal/seed/yh-ethio-music-agreement.pdf',
   '2023-10-01T09:00:00Z', null,'approved','2023-11-01T09:00:00Z', 6610),
  ('f0000000-0000-4000-8000-00000000ac09',
   'f0000000-0000-4000-8000-00000000aa06','f0000000-0000-4000-8000-00000000ab06',
   'Wello Wedi','wello-wedi-song',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/selam-worku/wello-wedi.mp3',
   263, 1, 'ET0002400004','licensed_master','Gondar Heritage Arts (fictional)',
   '/legal/seed/sw-gha-master-license.pdf','/legal/seed/gha-distribution-agreement.pdf',
   '2024-04-10T09:00:00Z','2027-04-10T00:00:00Z','approved','2024-05-01T09:00:00Z', 4320),
  ('f0000000-0000-4000-8000-00000000ac10',
   'f0000000-0000-4000-8000-00000000aa01', null,
   'Anbessa','anbessa',
   'https://trhfksuskfgvlmwzzsyu.supabase.co/storage/v1/object/public/tracks/seed/abebe-bekele/anbessa.mp3',
   198, null, 'ET0002400005','licensed_master','Addis Sound Records (fictional)',
   '/legal/seed/abr-asr-master-license.pdf','/legal/seed/asr-distribution-agreement.pdf',
   '2024-02-01T09:00:00Z','2027-02-01T00:00:00Z','approved','2024-02-10T09:00:00Z', 5210)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Song ↔ Genre links
-- ---------------------------------------------------------------------------
insert into public.song_genres (song_id, genre_id) values
  ('f0000000-0000-4000-8000-00000000ac01','f0000000-0000-4000-8000-00000000a001'),
  ('f0000000-0000-4000-8000-00000000ac01','f0000000-0000-4000-8000-00000000a008'),
  ('f0000000-0000-4000-8000-00000000ac02','f0000000-0000-4000-8000-00000000a001'),
  ('f0000000-0000-4000-8000-00000000ac03','f0000000-0000-4000-8000-00000000a002'),
  ('f0000000-0000-4000-8000-00000000ac04','f0000000-0000-4000-8000-00000000a002'),
  ('f0000000-0000-4000-8000-00000000ac05','f0000000-0000-4000-8000-00000000a003'),
  ('f0000000-0000-4000-8000-00000000ac06','f0000000-0000-4000-8000-00000000a003'),
  ('f0000000-0000-4000-8000-00000000ac07','f0000000-0000-4000-8000-00000000a004'),
  ('f0000000-0000-4000-8000-00000000ac08','f0000000-0000-4000-8000-00000000a006'),
  ('f0000000-0000-4000-8000-00000000ac09','f0000000-0000-4000-8000-00000000a005'),
  ('f0000000-0000-4000-8000-00000000ac10','f0000000-0000-4000-8000-00000000a001')
on conflict (song_id, genre_id) do nothing;

-- ---------------------------------------------------------------------------
-- Subscription plans (prices in ETB)
-- ---------------------------------------------------------------------------
insert into public.plans (id, code, name, name_am, description, price_etb, duration_days, features, is_active, sort_order) values
  ('f0000000-0000-4000-8000-00000000b001','free','Free','ነጻ',
   'Ad-supported listening with 30-second previews.', 0, 30,
   '["30-second previews","Ad-supported","Up to 3 playlists"]'::jsonb, true, 1),
  ('f0000000-0000-4000-8000-00000000b002','premium','Premium','ፕሪም',
   'Unlimited streaming of the full licensed catalog.', 99, 30,
   '["Unlimited streaming","No ads","Unlimited playlists","Offline saves"]'::jsonb, true, 2),
  ('f0000000-0000-4000-8000-00000000b003','family','Family','ቤተሰብ',
   'All Premium features for up to 4 profiles.', 199, 30,
   '["Up to 4 profiles","All Premium features"]'::jsonb, true, 3),
  ('f0000000-0000-4000-8000-00000000b004','artist-pro','Artist Pro','አርቲስት ፕሮ',
   'Upload & distribute licensed music with promo tools.', 299, 30,
   '["Upload licensed releases","Promotion tools","Analytics dashboard"]'::jsonb, true, 4)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Promotions — one live featured-artist campaign (fictional)
-- ---------------------------------------------------------------------------
insert into public.promotions (
  id, artist_id, song_id, promotion_type, status, starts_at, ends_at, amount_etb
) values
  ('f0000000-0000-4000-8000-00000000c001',
   'f0000000-0000-4000-8000-00000000aa02','f0000000-0000-4000-8000-00000000ac03',
   'featured_artist','active','2026-10-01T00:00:00Z','2026-11-01T00:00:00Z', 5000)
on conflict (id) do nothing;
