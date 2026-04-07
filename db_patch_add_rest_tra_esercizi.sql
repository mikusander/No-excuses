-- Add optional transition rest (seconds) between exercises.
-- Run this in Supabase SQL Editor on an existing database.

begin;

alter table public.esecuzioni
  add column if not exists rest_tra_esercizi integer;

-- Keep values non-negative when provided.
alter table public.esecuzioni
  drop constraint if exists esecuzioni_rest_tra_esercizi_nonneg;

alter table public.esecuzioni
  add constraint esecuzioni_rest_tra_esercizi_nonneg
  check (rest_tra_esercizi is null or rest_tra_esercizi >= 0);

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';

commit;
