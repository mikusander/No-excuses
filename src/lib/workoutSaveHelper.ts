/**
 * workoutSaveHelper.ts — Funzioni per il salvataggio degli esercizi di una scheda su Supabase.
 *
 * Gestisce la persistenza delle schede di allenamento nel database con supporto
 * a tutti i tipi di esercizio: reps semplici, isometrie, superset, EMOM e piramidi.
 *
 * Schema database (tabelle Supabase):
 *  - `esercizi`   : dizionario globale degli esercizi (nome univoco → id)
 *  - `esecuzioni` : righe esercizio collegate a una scheda (id_scheda)
 *  - `superset`   : metadati dei circuit superset (round_totali)
 *  - `emom`       : metadati EMOM (round_totali, durata_round_secondi)
 *  - `piramide`   : metadati piramide (id, senza dati aggiuntivi)
 *
 * Flusso principale di `saveExercisesToDb`:
 *  1. Cancella tutti gli esercizi esistenti della scheda (delete + re-insert)
 *  2. Per ogni esercizio, risolve (o crea) l'id nel dizionario `esercizi`
 *  3. Inserisce le righe in `esecuzioni` con i riferimenti ai gruppi (superset/emom/piramide)
 *  4. Esegue un bulk insert finale di tutte le righe costruite
 *
 * Nota sui metadati inline:
 *  I campi `auto_count_type` (pushups/pullups) vengono serializzati come
 *  `@@@meta:{...}` in coda al campo `note_esercizio` per retrocompatibilità
 *  con schemi DB che non hanno colonne dedicate per questi metadati.
 */
import { supabase } from './supabase';

/**
 * Rappresentazione di un esercizio da salvare nel database.
 * Corrisponde alla struttura UI normalizzata prima della persistenza.
 */
export interface SaveExercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string;
  /** Tipo di esercizio per il conteggio automatico (MediaPipe/accelerometro) */
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  /** Riposo tra questo esercizio e il successivo (transizione) */
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  emom_rounds?: number;
  emom_round_duration?: number;
  /** Sub-esercizi per superset ed EMOM */
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string;
  }[];
  /** Step della piramide (ogni step ha reps/rest/peso propri) */
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
  }[];
}

/**
 * Rimuove il suffisso `@@@meta:...` dal nome dell'esercizio prima di salvarlo
 * nel dizionario (il dizionario deve contenere solo il nome pulito).
 */
const normalizeExerciseName = (name: string) => name.replace(/@@@meta:.*$/, '').trim();

/**
 * Converte un valore peso in formato DB (2 decimali, null se non valido/negativo).
 * Rifiuta valori non finiti, NaN, e pesi ≤ 0 (nessun peso inserito).
 */
const toDbWeight = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
};

/**
 * `ensureExerciseDictionaryId` — Risolve o crea l'id dell'esercizio nel dizionario globale.
 *
 * Implementa un pattern "upsert sicuro" per ambienti multi-utente:
 *  1. Cerca il nome normalizzato nella tabella `esercizi`
 *  2. Se non esiste, tenta l'insert
 *  3. Se l'insert fallisce per race condition (altro utente ha inserito nel frattempo),
 *     esegue una seconda lettura per recuperare l'id appena inserito da un altro client
 *
 * @param name - Nome dell'esercizio (può contenere suffisso @@@meta: che viene rimosso)
 * @returns id_esercizio dell'esercizio nel dizionario
 */
const ensureExerciseDictionaryId = async (name: string) => {
  const normalized = normalizeExerciseName(name);

  // Tentativo 1: leggi se esiste già
  const { data: existing, error: existingError } = await supabase
    .from('esercizi')
    .select('id_esercizio')
    .eq('nome', normalized)
    .order('id_esercizio', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id_esercizio) return existing.id_esercizio;

  // Tentativo 2: inserisci il nuovo esercizio
  const { data: inserted, error: insertError } = await supabase
    .from('esercizi')
    .insert([{ nome: normalized }])
    .select('id_esercizio')
    .single();

  if (!insertError && inserted?.id_esercizio) return inserted.id_esercizio;

  // Tentativo 3: race condition — un altro client ha inserito prima di noi, rileggi
  const { data: afterRace, error: raceReadError } = await supabase
    .from('esercizi')
    .select('id_esercizio')
    .eq('nome', normalized)
    .order('id_esercizio', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (raceReadError || !afterRace?.id_esercizio) throw insertError || raceReadError;
  return afterRace.id_esercizio;
};

/**
 * `saveExercisesToDb` — Salva (o aggiorna) l'elenco degli esercizi di una scheda.
 *
 * Strategia: delete + re-insert (non update singolo) per semplicità e coerenza.
 * Elimina prima tutti gli esercizi esistenti della scheda, poi ricostruisce
 * tutte le righe da zero inserendole in un unico bulk insert.
 *
 * Il campo `ordine` (orderCounter) determina la sequenza di esecuzione degli esercizi.
 * Per esercizi composti (superset/EMOM/piramide) ogni sub-esercizio/step occupa
 * una posizione separata con lo stesso `ordine` per il gruppo padre o un indice crescente.
 *
 * @param schedaId  - ID della scheda da aggiornare
 * @param exercises - Lista degli esercizi nella loro struttura UI normalizzata
 */
export const saveExercisesToDb = async (schedaId: number, exercises: SaveExercise[]): Promise<void> => {
  // Delete old exercises
  const { error: deleteError } = await supabase
    .from('esecuzioni')
    .delete()
    .eq('id_scheda', schedaId);
  if (deleteError) throw deleteError;

  const rowsToInsert: any[] = [];
  let orderCounter = 1; // Contatore ordinamento sequenziale per tutta la scheda

  for (let idx = 0; idx < exercises.length; idx += 1) {
    const ex = exercises[idx];

    // Il riposo di transizione viene salvato solo se non è l'ultimo esercizio
    const transitionRestToPersist =
      idx < exercises.length - 1 && (ex.transition_rest_seconds || 0) > 0
        ? Math.max(0, Math.trunc(ex.transition_rest_seconds || 0))
        : null;

    // ── SUPERSET ────────────────────────────────────────────────────────────
    if (ex.type === 'superset') {
      // Crea il record superset con il numero di round
      const { data, error: supersetError } = await supabase
        .from('superset')
        .insert([{ round_totali: Math.max(1, ex.sets) }])
        .select('id_superset')
        .single();
      if (supersetError) throw supersetError;

      // Inserisce ogni sub-esercizio del superset come riga separata in esecuzioni
      for (let subIdx = 0; subIdx < (ex.subExercises || []).length; subIdx += 1) {
        const sub = ex.subExercises![subIdx];
        const idEsercizio = await ensureExerciseDictionaryId(sub.name);
        const isIso = sub.type === 'isometry';

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: Math.max(1, ex.sets || 1),
          rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(sub.weight_kg),
          note_esercizio: String(sub.instruction_note || '').trim() || null,
          tipo: isIso ? 'ISOMETRIA' : 'REPS',
          reps: isIso ? null : Math.max(0, sub.reps ?? 0),
          durata_secondi: isIso ? Math.max(0, sub.duration_seconds ?? 0) : null,
          id_superset: data.id_superset,
          id_piramide: null,
          stepindex_piramide: null,
          id_emom: null,
          stepindex_emom: null,
        });

        orderCounter += 1;
      }

      continue; // Salta il blocco default sotto
    }

    // ── EMOM (Every Minute On the Minute) ───────────────────────────────────
    if (ex.type === 'emom') {
      // Crea il record EMOM con round totali e durata per round
      const { data, error: emomError } = await supabase
        .from('emom')
        .insert([{ round_totali: Math.max(1, ex.emom_rounds || 1), durata_round_secondi: Math.max(1, ex.emom_round_duration || 60) }])
        .select('id_emom')
        .single();
      if (emomError) throw emomError;

      // Inserisce ogni movimento dell'EMOM come riga separata
      for (let subIdx = 0; subIdx < (ex.subExercises || []).length; subIdx += 1) {
        const sub = ex.subExercises![subIdx];
        const idEsercizio = await ensureExerciseDictionaryId(sub.name);
        const isIso = sub.type === 'isometry';

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: Math.max(1, ex.sets || 1),
          rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(sub.weight_kg),
          note_esercizio: String(sub.instruction_note || '').trim() || null,
          tipo: isIso ? 'ISOMETRIA' : 'REPS',
          reps: isIso ? null : Math.max(0, sub.reps ?? 0),
          durata_secondi: isIso ? Math.max(0, sub.duration_seconds ?? 0) : null,
          id_superset: null,
          id_piramide: null,
          stepindex_piramide: null,
          id_emom: data.id_emom,
          stepindex_emom: subIdx + 1, // Indice 1-based dello step EMOM
        });

        orderCounter += 1;
      }

      continue;
    }

    // ── PIRAMIDE ─────────────────────────────────────────────────────────────
    if (ex.type === 'pyramid') {
      // Crea il record piramide (solo id, i dati sono negli step)
      const { data, error: piramideError } = await supabase
        .from('piramide')
        .insert([{}])
        .select('id_piramide')
        .single();
      if (piramideError) throw piramideError;

      // Ogni step della piramide è una riga con reps/rest/peso propri
      for (let stepIdx = 0; stepIdx < (ex.pyramid_steps || []).length; stepIdx += 1) {
        const step = ex.pyramid_steps![stepIdx];
        const idEsercizio = await ensureExerciseDictionaryId(ex.name);

        rowsToInsert.push({
          id_scheda: schedaId,
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: 1, // Ogni step della piramide è un singolo set
          rest_secondi: step.rest_seconds > 0 ? step.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(step.weight_kg),
          note_esercizio: String(ex.instruction_note || '').trim() || null,
          tipo: 'REPS',
          reps: Math.max(0, step.reps ?? 0),
          durata_secondi: null,
          id_superset: null,
          id_piramide: data.id_piramide,
          stepindex_piramide: stepIdx + 1, // Indice 1-based dello step piramide
          id_emom: null,
          stepindex_emom: null,
        });

        orderCounter += 1;
      }

      continue;
    }

    // ── ESERCIZIO SEMPLICE (reps o isometry) ─────────────────────────────────
    const idEsercizio = await ensureExerciseDictionaryId(ex.name);
    const isIsometry = ex.type === 'isometry';

    // Serializza i metadati auto_count_type nel campo note come suffisso @@@meta:
    let noteToSave = String(ex.instruction_note || '').trim();
    if (ex.auto_count_type) {
      noteToSave += (noteToSave ? ' ' : '') + `@@@meta:${JSON.stringify({ autoCountType: ex.auto_count_type })}`;
    }

    rowsToInsert.push({
      id_scheda: schedaId,
      id_esercizio: idEsercizio,
      ordine: orderCounter,
      set_num: Math.max(1, ex.sets || 1),
      rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
      rest_tra_esercizi: transitionRestToPersist,
      peso_kg: toDbWeight(ex.weight_kg),
      note_esercizio: noteToSave || null,
      tipo: isIsometry ? 'ISOMETRIA' : 'REPS',
      reps: isIsometry ? null : Math.max(0, ex.reps ?? 0),
      durata_secondi: isIsometry ? Math.max(0, ex.duration_seconds ?? 0) : null,
      id_superset: null,
      id_piramide: null,
      stepindex_piramide: null,
      id_emom: null,
      stepindex_emom: null,
    });

    orderCounter += 1;
  }

  // Bulk insert di tutte le righe costruite
  const { error: exercisesError } = await supabase
    .from('esecuzioni')
    .insert(rowsToInsert);

  if (exercisesError) throw exercisesError;
};
