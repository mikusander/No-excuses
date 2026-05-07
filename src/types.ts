export type ExerciseType = 'pullups' | 'pushups' | 'squats';

export interface WorkoutConfig {
  pullupsCount: number;
  pushupsCount: number;
  squatsCount: number;
}

export type AppState = 'config' | 'workout' | 'summary';

export interface RepCount {
  currentReps: number;
  targetReps: number;
}
