-- Smoke tests for schema in `codice database`
-- Run AFTER schema creation in Supabase SQL Editor.
-- It uses a transaction and ROLLBACK, so no persistent test data is left.

begin;

do $$
declare
  v_user_id uuid := '11111111-1111-1111-1111-111111111111';
  v_other_user uuid := '22222222-2222-2222-2222-222222222222';
  v_esercizio_id bigint;
  v_esercizio_id_2 bigint;
  v_scheda_id bigint;
  v_workout_id bigint;
  v_superset_id bigint;
  v_emom_id bigint;
  v_ok boolean;
begin
  raise notice 'START smoke tests';

  -- IMPORTANT: this test assumes auth.users rows may not exist in SQL editor context.
  -- So we only test tables that do not require inserting into profili unless your auth users exist.
  -- If you already have real users, replace IDs below with existing auth.users IDs and uncomment profile tests.

  -- Base dictionary test
  insert into public.esercizi(nome) values ('Push Up') returning id_esercizio into v_esercizio_id;
  insert into public.esercizi(nome) values ('Burpee') returning id_esercizio into v_esercizio_id_2;
  if v_esercizio_id is null then
    raise exception 'FAIL: esercizi insert failed';
  end if;

  -- Numeric > 0 test on esercizi name constraint
  begin
    insert into public.esercizi(nome) values ('   ');
    raise exception 'FAIL: blank nome accepted unexpectedly';
  exception
    when check_violation then
      raise notice 'PASS: esercizi nome non blank';
  end;

  -- Superset numeric > 0
  begin
    insert into public.superset(round_totali) values (0);
    raise exception 'FAIL: superset round_totali=0 accepted unexpectedly';
  exception
    when check_violation then
      raise notice 'PASS: superset round_totali > 0';
  end;

  insert into public.superset(round_totali) values (3) returning id_superset into v_superset_id;

  -- Emom numeric > 0
  begin
    insert into public.emom(round_totali, durata_round_secondi) values (0, 30);
    raise exception 'FAIL: emom round_totali=0 accepted unexpectedly';
  exception
    when check_violation then
      raise notice 'PASS: emom round_totali > 0';
  end;

  begin
    insert into public.emom(round_totali, durata_round_secondi) values (5, 0);
    raise exception 'FAIL: emom durata_round_secondi=0 accepted unexpectedly';
  exception
    when check_violation then
      raise notice 'PASS: emom durata_round_secondi > 0';
  end;

  insert into public.emom(round_totali, durata_round_secondi) values (5, 60) returning id_emom into v_emom_id;

  -- NOTE: tests below require an existing profile row; skip if not available
  select exists(select 1 from public.profili limit 1) into v_ok;

  if not v_ok then
    raise notice 'SKIP: no rows in profili. Add real users/profile rows to test schede/workout/esecuzioni/follower/libero fully.';
  else
    -- pick first existing profile
    select id_utente into v_user_id from public.profili limit 1;
    select id_utente into v_other_user from public.profili where id_utente <> v_user_id limit 1;

    insert into public.schede(id_utente, nome, pubblica)
    values (v_user_id, 'Test scheda', false)
    returning id_scheda into v_scheda_id;

    -- WORKOUT.DATA COERENZA: invalid date before creation must fail
    begin
      insert into public.workout_run(id_utente, id_scheda, data_esecuzione)
      values (v_user_id, v_scheda_id, now() - interval '10 days');
      raise exception 'FAIL: workout date coherence not enforced';
    exception
      when raise_exception then
        if position('DATA(workout) deve essere >=' in sqlerrm) > 0 then
          raise notice 'PASS: workout data coerenza trigger';
        else
          raise;
        end if;
    end;

    insert into public.workout_run(id_utente, id_scheda, data_esecuzione)
    values (v_user_id, v_scheda_id, now())
    returning id_workout into v_workout_id;

    insert into public.note_workout(id_workout, testo) values (v_workout_id, 'ok');

    -- ESECUZIONE.APPARTENENZA / ESISTENZA
    begin
      insert into public.esecuzioni(
        id_scheda, id_esercizio, ordine, tipo, reps, durata_secondi
      ) values (
        v_scheda_id, v_esercizio_id, 1, 'REPS', null, null
      );
      raise exception 'FAIL: tipo coerenza not enforced';
    exception
      when check_violation then
        raise notice 'PASS: tipo coerenza enforces REPS/ISOMETRIA mapping';
    end;

    -- SUPSERSET.COHERENZA trigger: set_num must equal round_totali
    begin
      insert into public.esecuzioni(
        id_scheda, id_esercizio, ordine, set_num, tipo, reps, id_superset
      ) values (
        v_scheda_id, v_esercizio_id, 2, 2, 'REPS', 10, v_superset_id
      );
      raise exception 'FAIL: superset coerenza not enforced';
    exception
      when raise_exception then
        if position('SUPERSET.COHERENZA' in sqlerrm) > 0 then
          raise notice 'PASS: superset coerenza trigger';
        else
          raise;
        end if;
    end;

    -- Valid superset execution
    insert into public.esecuzioni(
      id_scheda, id_esercizio, ordine, set_num, tipo, reps, id_superset
    ) values (
      v_scheda_id, v_esercizio_id, 3, 3, 'REPS', 10, v_superset_id
    );

    -- Same exercise can be repeated in the same scheda with a different ordine
    begin
      insert into public.esecuzioni(
        id_scheda, id_esercizio, ordine, set_num, tipo, reps
      ) values (
        v_scheda_id, v_esercizio_id, 4, 3, 'REPS', 8
      );
      raise notice 'PASS: same exercise can be repeated in the same scheda';
    exception
      when others then
        raise exception 'FAIL: same exercise repetition should be allowed, got: %', sqlerrm;
    end;

    -- Exclusivity: cannot link both emom and superset
    begin
      insert into public.esecuzioni(
        id_scheda, id_esercizio, ordine, set_num, tipo, reps, id_superset, id_emom, stepindex_emom
      ) values (
        v_scheda_id, v_esercizio_id_2, 5, 3, 'REPS', 10, v_superset_id, v_emom_id, 1
      );
      raise exception 'FAIL: exclusivity constraint not enforced';
    exception
      when check_violation then
        raise notice 'PASS: exclusivity among superset/piramide/emom';
    end;

    -- Follower self-follow must fail
    begin
      insert into public.follower(id_follower, id_seguito) values (v_user_id, v_user_id);
      raise exception 'FAIL: self-follow accepted';
    exception
      when check_violation then
        raise notice 'PASS: follower non se stesso';
    end;

    -- Libero same day uniqueness
    insert into public.libero(id_utente, id_esercizio, conteggio, data_esecuzione)
    values (v_user_id, v_esercizio_id, 10, date_trunc('day', now()));

    begin
      insert into public.libero(id_utente, id_esercizio, conteggio, data_esecuzione)
      values (v_user_id, v_esercizio_id, 12, date_trunc('day', now()) + interval '2 hours');
      raise exception 'FAIL: libero same-day uniqueness not enforced';
    exception
      when unique_violation then
        raise notice 'PASS: libero coerenza tempo (same day uniqueness)';
    end;
  end if;

  raise notice 'END smoke tests';
end
$$;

rollback;
