import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RepCounterPage from './pages/RepCounterPage';

import AuthPage from './pages/AuthPage';
import NewTrainPage from './pages/NewTrainPage';
import GymCardPage from './pages/GymCardPage';
import SettingsPage from './pages/SettingsPage';
import SelectWorkoutPage from './pages/SelectWorkoutPage';
import ActiveWorkoutPage from './pages/ActiveWorkoutPage';
import { useAuth } from './context/AuthContext';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen bg-brand-dark flex items-center justify-center text-brand-orange">Caricamento...</div>;
  }

  if (!user) {
    // Reindirizza al login se non autenticato
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};


function App() {
  return (
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
  );
}

export default App;
