-- Add optional structural exercise notes for template rows.
-- Run this in Supabase SQL Editor on an existing database.

begin;

alter table public.esecuzioni
  add column if not exists note_esercizio text;

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';

commit;
