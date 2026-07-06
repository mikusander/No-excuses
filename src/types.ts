/**
 * types.ts — Definizioni dei tipi globali condivisi nell'applicazione.
 *
 * Contiene i tipi di base utilizzati da più componenti/hook per garantire
 * la coerenza dei dati attraverso il flusso dell'app.
 */

/** Tipi di esercizio supportati dal contatore reps automatico (MediaPipe/accelerometro) */
export type ExerciseType = 'pullups' | 'pushups';

/** Configurazione di un workout per il contatore libero (RepCounterPage) */
export interface WorkoutConfig {
  pullupsCount: number;
  pushupsCount: number;
}

/** Stato macchina della sessione workout nella RepCounterPage */
export type AppState = 'config' | 'workout' | 'summary';

/** Contatore corrente/target per un esercizio in una serie */
export interface RepCount {
  currentReps: number;
  targetReps: number;
}
