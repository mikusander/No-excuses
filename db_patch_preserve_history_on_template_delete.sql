-- Preserve workout history when deleting a workout template (scheda)
-- Run this in Supabase SQL Editor on an existing database.

begin;

alter table public.workout_run
  add column if not exists workout_name_snapshot text;

alter table public.workout_run
  add column if not exists exercises_snapshot jsonb;

-- Backfill workout names from linked schede for existing rows.
update public.workout_run wr
set workout_name_snapshot = coalesce(nullif(trim(s.nome), ''), 'Workout #' || wr.id_workout::text)
from public.schede s
where wr.id_scheda = s.id_scheda
  and (wr.workout_name_snapshot is null or length(trim(wr.workout_name_snapshot)) = 0);

-- Ensure every row has at least a fallback snapshot name.
update public.workout_run
set workout_name_snapshot = 'Workout #' || id_workout::text
where workout_name_snapshot is null or length(trim(workout_name_snapshot)) = 0;

-- Make workout_run independent from schede deletion.
alter table public.workout_run
  alter column id_scheda drop not null;

alter table public.workout_run
  drop constraint if exists fk_workout_scheda;

alter table public.workout_run
  add constraint fk_workout_scheda
  foreign key (id_scheda)
  references public.schede(id_scheda)
  on delete set null;

-- Keep date coherence check for linked templates, but allow NULL after template deletion.
create or replace function public.fn_check_workout_data_coerenza()
returns trigger
language plpgsql
as $$
declare
  v_data_creazione timestamptz;
begin
  if new.id_scheda is null then
    return new;
  end if;

  select s.data_creazione
    into v_data_creazione
  from public.schede s
  where s.id_scheda = new.id_scheda;

  if v_data_creazione is null then
    raise exception 'Scheda % non trovata', new.id_scheda;
  end if;

  if new.data_esecuzione < v_data_creazione then
    raise exception 'DATA(workout) deve essere >= DATA_CREAZIONE(scheda). workout=%, scheda=%', new.data_esecuzione, v_data_creazione;
  end if;

  return new;
end;
$$;

-- Refresh PostgREST schema cache.
notify pgrst, 'reload schema';

commit;
