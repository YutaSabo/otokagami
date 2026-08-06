-- Keep pronunciation practice selection independent of nationality and native language.
-- The removed metadata was seed-owned and was used only as a tie-breaker.

alter table public.phonemes
  drop column ja_difficulty;

alter table public.phoneme_clusters
  drop column ja_difficulty;

alter table public.practice_items
  drop column ja_difficulty;
