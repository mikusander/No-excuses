/**
 * App.tsx — Radice del routing dell'applicazione.
 *
 * Configura tutte le rotte con React Router v6.
 * Le rotte "protette" tramite `ProtectedRoute` richiedono che l'utente sia autenticato;
 * in caso contrario viene reindirizzato alla pagina di login (/auth).
 *
 * Struttura delle rotte:
 *  - /           → HomePage          (pubblica)
 *  - /auth       → AuthPage          (pubblica — login/signup)
 *  - /reps-count → RepCounterPage    (protetta — contatore libero)
 *  - /new-train  → NewTrainPage      (protetta — creazione scheda)
 *  - /edit-train/:id → NewTrainPage  (protetta — modifica scheda esistente)
 *  - /gym-card   → GymCardPage       (protetta — lista schede)
 *  - /workout-history → WorkoutHistoryPage        (protetta)
 *  - /workout-history/:workoutRunId → WorkoutHistoryDetailPage (protetta)
 *  - /select-workout  → SelectWorkoutPage          (protetta)
 *  - /active-workout/:id → ActiveWorkoutPage        (protetta — workout live da scheda)
 *  - /active-workout-history/:workoutRunId → ActiveWorkoutPage (protetta — riesegui da storico)
 *  - /settings   → SettingsPage      (protetta)
 *
 * Se la configurazione Supabase non è valida (env mancanti) viene mostrato un
 * banner di errore al posto dell'intera applicazione.
 *
 * `ResetPasswordModal` viene montato in overlay globale quando l'utente atterra
 * sull'app tramite link email di recupero password (evento PASSWORD_RECOVERY).
 */
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

/**
 * ProtectedRoute — Wrapper per le rotte che richiedono autenticazione.
 *
 * Mostra un loader mentre lo stato auth è in caricamento.
 * Se l'utente non è loggato, reindirizza a /auth salvando la destinazione originale
 * nello state di navigazione (così dopo il login si torna dove si voleva andare).
 */
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

  // Mostra un banner di errore se le variabili d'ambiente Supabase non sono configurate
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
      {/* Modal globale per il reset password — visibile solo dopo click su link email di recupero */}
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
        {/* Riusa NewTrainPage in modalità modifica, ricevendo l'id della scheda da :id */}
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
        {/* Dettaglio di una sessione workout già completata */}
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
        {/* Workout live — avviato da una scheda */}
        <Route path="/active-workout/:id" element={
          <ProtectedRoute>
            <ActiveWorkoutPage />
          </ProtectedRoute>
        } />
        {/* Workout live — rieseguito da uno storico (workoutRunId) */}
        <Route path="/active-workout-history/:workoutRunId" element={
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
