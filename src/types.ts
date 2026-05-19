export type ExerciseType = 'pullups' | 'pushups';

export interface WorkoutConfig {
  pullupsCount: number;
  pushupsCount: number;
}

export type AppState = 'config' | 'workout' | 'summary';

export interface RepCount {
  currentReps: number;
  targetReps: number;
}
