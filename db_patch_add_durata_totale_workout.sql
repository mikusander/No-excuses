-- Add optional total duration (seconds) for completed workouts.
-- Run this in Supabase SQL Editor on an existing database.

begin;

alter table public.workout_run
  add column if not exists durata_totale_secondi integer;

-- Keep values non-negative when provided.
alter table public.workout_run
  drop constraint if exists workout_run_durata_totale_secondi_nonneg;

alter table public.workout_run
  add constraint workout_run_durata_totale_secondi_nonneg
  check (durata_totale_secondi is null or durata_totale_secondi >= 0);

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';

commit;
