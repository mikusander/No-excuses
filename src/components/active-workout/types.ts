export type ExerciseType = 'reps' | 'isometry' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid';

export interface ExerciseSubItem {
  name: string;
  type: 'reps' | 'isometry' | 'cardio';
  reps: number;
  duration_seconds: number;
  weight_kg?: number | null;
  instruction_note?: string | null;
}

export interface ExercisePyramidStep {
  reps: number;
  rest_seconds: number;
  weight_kg?: number | null;
}

export interface Exercise {
  id: string;
  type: ExerciseType;
  name: string;
  instruction_note?: string | null;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  lap_durations_seconds?: number[];
  total_circuit_duration_seconds?: number;
  emom_rounds?: number;
  emom_round_duration?: number;
  pyramid_steps?: ExercisePyramidStep[];
  order_index: number;
  completed_sets_records?: (number | null)[];
  completed_sets_reps?: (number | null)[];
  subExercises?: ExerciseSubItem[];
}

export interface Workout {
  id: string;
  name: string;
  exercises: Exercise[];
}

export interface ExerciseNoteEntry {
  exerciseName: string;
  note: string;
}

export interface NoteModalContext {
  key: string;
  name: string;
  exerciseIndex?: number;
  exercise?: Exercise;
}

export interface InstructionModalItem {
  name: string;
  note: string;
}

export interface InstructionModalContext {
  exerciseName: string;
  note: string | null;
  items: InstructionModalItem[];
}

export interface ExerciseEditDraftSubItem {
  name: string;
  type: 'reps' | 'isometry' | 'cardio';
  reps: string;
  durationSeconds: string;
  weightKg: string;
}

export interface ExerciseEditDraftPyramidStep {
  reps: string;
  restSeconds: string;
  weightKg: string;
}

export interface ExerciseEditDraft {
  sets: string;
  restSeconds: string;
  reps: string;
  durationSeconds: string;
  weightKg: string;
  emomRounds: string;
  emomRoundDuration: string;
  currentSubReps: string;
  currentSubDuration: string;
  currentSubWeightKg: string;
  currentStepReps: string;
  currentStepRestSeconds: string;
  currentStepWeightKg: string;
  subExerciseDrafts: ExerciseEditDraftSubItem[];
  pyramidStepDrafts: ExerciseEditDraftPyramidStep[];
}
