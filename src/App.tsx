import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RepCounterPage from './pages/RepCounterPage';

import AuthPage from './pages/AuthPage';
import NewTrainPage from './pages/NewTrainPage';
import GymCardPage from './pages/GymCardPage';
import WorkoutHistoryPage from './pages/WorkoutHistoryPage';
import WorkoutHistoryDetailPage from './pages/WorkoutHistoryDetailPage';
import SettingsPage from './pages/SettingsPage';
import SelectWorkoutPage from './pages/SelectWorkoutPage';
import ActiveWorkoutPage from './pages/ActiveWorkoutPage';
import { useAuth } from './context/AuthContext';
import ResetPasswordModal from './components/ResetPasswordModal';
import { supabaseConfigError } from './lib/supabase';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen bg-brand-dark flex items-center justify-center text-brand-orange">Loading...</div>;
  }

  if (!user) {
    // Reindirizza al login se non autenticato
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

function App() {
  const { isPasswordRecovery } = useAuth();

  if (supabaseConfigError) {
    return (
      <div className="min-h-screen bg-brand-dark flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-100">
          <h1 className="text-xl font-bold mb-3">Missing Supabase configuration</h1>
          <p className="text-sm leading-relaxed">
            Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in production, then deploy again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isPasswordRecovery && <ResetPasswordModal />}
      <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/" element={<HomePage />} />
        
        {/* Protected Routes */}
        <Route path="/reps-count" element={
          <ProtectedRoute>
            <RepCounterPage />
          </ProtectedRoute>
        } />
        <Route path="/new-train" element={
          <ProtectedRoute>
            <NewTrainPage />
          </ProtectedRoute>
        } />
        <Route path="/edit-train/:id" element={
          <ProtectedRoute>
            <NewTrainPage />
          </ProtectedRoute>
        } />
        <Route path="/gym-card" element={
          <ProtectedRoute>
            <GymCardPage />
          </ProtectedRoute>
        } />
        <Route path="/workout-history" element={
          <ProtectedRoute>
            <WorkoutHistoryPage />
          </ProtectedRoute>
        } />
        <Route path="/workout-history/:workoutRunId" element={
          <ProtectedRoute>
            <WorkoutHistoryDetailPage />
          </ProtectedRoute>
        } />
        <Route path="/select-workout" element={
          <ProtectedRoute>
            <SelectWorkoutPage />
          </ProtectedRoute>
        } />
        <Route path="/active-workout/:id" element={
          <ProtectedRoute>
            <ActiveWorkoutPage />
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
    </>
  );
}

export default App;
