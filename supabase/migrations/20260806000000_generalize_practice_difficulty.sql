-- Keep pronunciation practice selection independent of nationality and native language.
-- These columns are retained only as legacy metadata for v1 rollback compatibility.
-- New v2 selection and scoring must not read or update them.

alter table public.phonemes
  alter column ja_difficulty set default 'medium';

alter table public.phoneme_clusters
  alter column ja_difficulty set default 'medium';

alter table public.practice_items
  alter column ja_difficulty set default 'medium';

comment on column public.phonemes.ja_difficulty is
  'Legacy v1 metadata retained for rollback compatibility; not used by v2 selection or scoring.';

comment on column public.phoneme_clusters.ja_difficulty is
  'Legacy v1 metadata retained for rollback compatibility; not used by v2 selection or scoring.';

comment on column public.practice_items.ja_difficulty is
  'Legacy v1 metadata retained for rollback compatibility; not used by v2 selection or scoring.';
