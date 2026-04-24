-- Allow MAX target persistence for workout executions.
-- MAX is represented as 0 for reps or isometric duration.
-- Run this in Supabase SQL Editor on an existing database.

begin;

alter table public.esecuzioni
  drop constraint if exists ck_esecuzioni_reps_pos;

alter table public.esecuzioni
  add constraint ck_esecuzioni_reps_pos
  check (reps is null or reps >= 0);

alter table public.esecuzioni
  drop constraint if exists ck_esecuzioni_durata_pos;

alter table public.esecuzioni
  add constraint ck_esecuzioni_durata_pos
  check (durata_secondi is null or durata_secondi >= 0);

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';

commit;
