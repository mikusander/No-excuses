import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HeaderLogo from '../components/HeaderLogo';
import WorkoutCard from '../components/WorkoutCard';
import BottomNavigation from '../components/BottomNavigation';
import { useAuth } from '../context/AuthContext';
import {
  clearAllWorkoutProgressCheckpoints,
  getLatestWorkoutProgressCheckpoint,
  pruneWorkoutProgressCheckpoints,
} from '../lib/workoutProgressStorage';

interface ResumeCheckpointCandidate {
  targetPath: string;
  savedAtMs: number;
  label: string;
}

const RESUME_PROMPT_SESSION_KEY = 'resume_prompt_shown_v1';

const formatCheckpointTimestamp = (savedAtMs: number) => {
  const parsed = new Date(savedAtMs);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const HomePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [resumeCandidate, setResumeCandidate] = useState<ResumeCheckpointCandidate | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setResumeCandidate(null);
      return;
    }

    if (sessionStorage.getItem(RESUME_PROMPT_SESSION_KEY) === '1') {
      return;
    }

    const latestCheckpoint = getLatestWorkoutProgressCheckpoint(user.id);
    if (!latestCheckpoint) return;

    pruneWorkoutProgressCheckpoints(user.id, latestCheckpoint.key);

    const isHistoryRun = latestCheckpoint.identity.type === 'run';
    const resumeModel: ResumeCheckpointCandidate = {
      targetPath: isHistoryRun
        ? `/active-workout-history/${latestCheckpoint.identity.id}`
        : `/active-workout/${latestCheckpoint.identity.id}`,
      savedAtMs: latestCheckpoint.savedAtMs,
      label: isHistoryRun
        ? `history workout #${latestCheckpoint.identity.id}`
        : `workout #${latestCheckpoint.identity.id}`,
    };

    setResumeCandidate(resumeModel);
    sessionStorage.setItem(RESUME_PROMPT_SESSION_KEY, '1');
  }, [user?.id]);

  const closeResumePrompt = () => {
    if (user?.id) {
      clearAllWorkoutProgressCheckpoints(user.id);
    }
    setResumeCandidate(null);
  };

  const resumeWorkout = () => {
    if (!resumeCandidate) return;
    navigate(resumeCandidate.targetPath);
  };

  return (
    <div className="pb-24 flex flex-col items-center relative min-h-screen">
      <HeaderLogo />

      <main className="w-full flex flex-col items-center mt-4 space-y-8">
        <div className="w-full flex justify-center animate-home-card animate-home-card-delay-1">
          <WorkoutCard
            imageSrc="/images/download.jpeg"
            buttonText="START NEW TRAIN"
            to="/select-workout"
            ctaVariant="primary"
          />
        </div>

        <div className="w-full flex justify-center animate-home-card animate-home-card-delay-2">
          <WorkoutCard
            imageSrc="/images/download (1).jpeg"
            buttonText="START REPS COUNT"
            to="/reps-count"
            ctaVariant="secondary"
          />
        </div>
      </main>

      {resumeCandidate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-black text-white">Resume workout?</h2>
            <p className="text-sm text-brand-grey mt-2 leading-relaxed">
              I found a saved checkpoint for {resumeCandidate.label}.
            </p>
            <p className="text-xs text-brand-grey/80 mt-2">
              Last saved: {formatCheckpointTimestamp(resumeCandidate.savedAtMs)}
            </p>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={closeResumePrompt}
                className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold"
              >
                No, start new workout
              </button>
              <button
                onClick={resumeWorkout}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black"
              >
                Resume
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNavigation />
    </div>
  );
};

export default HomePage;
