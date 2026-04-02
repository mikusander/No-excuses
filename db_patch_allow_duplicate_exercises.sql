-- Allow the same exercise to appear multiple times in the same scheda.
-- Run this in Supabase SQL Editor on an existing database.

begin;

drop trigger if exists trg_check_esecuzione_ordine_fd on public.esecuzioni;
drop function if exists public.fn_check_esecuzione_ordine_fd();

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';

commit;
