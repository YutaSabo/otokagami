\set ON_ERROR_STOP on

do $$
begin
  if (select count(*) from public.phonemes) <> 41 then
    raise exception 'Content seed failed: expected 41 phonemes';
  end if;

  if (select count(*) from public.phoneme_clusters) <> 20 then
    raise exception 'Content seed failed: expected 20 phoneme clusters';
  end if;

  if (select count(*) from public.practice_items) <> 428 then
    raise exception 'Content seed failed: expected 428 practice items';
  end if;

  if (select count(*) from public.practice_item_targets) <> 428 then
    raise exception 'Content seed failed: expected 428 practice item targets';
  end if;

  if exists (
    select 1
    from public.phonemes p
    left join public.practice_item_targets t
      on t.target_type = 'phoneme'
      and t.target_id = p.phoneme_id
    left join public.practice_items i
      on i.practice_item_id = t.practice_item_id
    group by p.phoneme_id
    having count(*) filter (where i.item_type = 'word') < 5
        or count(*) filter (where i.item_type = 'sentence') < 3
  ) then
    raise exception 'Content seed failed: every phoneme must have at least 5 words and 3 sentences';
  end if;

  if exists (
    select 1
    from public.phoneme_clusters c
    left join public.practice_item_targets t
      on t.target_type = 'cluster'
      and t.target_id = c.cluster_id
    left join public.practice_items i
      on i.practice_item_id = t.practice_item_id
    group by c.cluster_id
    having count(*) filter (where i.item_type = 'word') < 3
        or count(*) filter (where i.item_type = 'sentence') < 2
  ) then
    raise exception 'Content seed failed: every cluster must have at least 3 words and 2 sentences';
  end if;

  if (select count(*) from public.practice_items where is_active) <> 6 then
    raise exception 'Content seed failed: expected 6 active reviewed practice items';
  end if;

  if exists (
    select 1
    from public.practice_items
    where is_active
      and source <> 'manual_reviewed'
  ) then
    raise exception 'Content seed failed: active practice items must be manual_reviewed';
  end if;

  if exists (
    select 1
    from public.practice_items
    where is_active
      and expected_ipa is null
  ) then
    raise exception 'Content seed failed: active practice items must have expected_ipa';
  end if;

  if (select count(*) from public.practice_items where not is_active) <> 422 then
    raise exception 'Content seed failed: expected 422 inactive practice candidates';
  end if;

  if (select count(*) from public.advice_pages where confusion_pair_id is not null) <> 13 then
    raise exception 'Content seed failed: expected 13 priority advice pages';
  end if;

  if (select count(*) from public.advice_pages where generic_advice_id is not null) <> 5 then
    raise exception 'Content seed failed: expected 5 generic advice pages';
  end if;

  if exists (
    select 1
    from public.advice_pages
    where asset_id is null
  ) then
    raise exception 'Content seed failed: every advice page must reference an asset_id';
  end if;

  if exists (
    select 1
    from public.advice_pages
    where is_active
  ) then
    raise exception 'Content seed failed: unreviewed Phase 4 advice pages must stay inactive';
  end if;
end;
$$;
