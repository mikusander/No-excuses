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
import { useEffect } from 'react';
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
import ActiveWorkoutBanner from './components/ActiveWorkoutBanner';
import { supabaseConfigError } from './lib/supabase';
import { lockAppToPortrait, useIsLandscape } from './utils/orientationManager';
import { Smartphone } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';

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

/**
 * OrientationWatcher — Assicura che fuori dalla schermata di workout attivo (/active-workout)
 * l'app sia rigorosamente bloccata in modalità verticale (portrait).
 * Su browser web mobile (Safari), mostra una guida non invasiva se il telefono è ruotato fuori dal workout.
 */
const OrientationWatcher = () => {
  const location = useLocation();
  const isLandscape = useIsLandscape();
  const isWorkoutRoute = location.pathname.startsWith('/active-workout');

  useEffect(() => {
    if (!isWorkoutRoute) {
      lockAppToPortrait();
    }
  }, [location.pathname, isWorkoutRoute]);

  // Se l'utente è fuori dal workout su dispositivo mobile orientato orizzontalmente (altezza < 520px)
  const isMobileLandscapeOutsideWorkout = !isWorkoutRoute && isLandscape && typeof window !== 'undefined' && window.innerHeight < 520;

  if (isMobileLandscapeOutsideWorkout) {
    return (
      <div className="fixed inset-0 z-[999] bg-brand-dark/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-16 h-16 rounded-3xl bg-brand-darkGrey/80 border border-brand-orange/30 flex items-center justify-center text-brand-orange mb-4 shadow-xl animate-pulse">
          <Smartphone size={32} className="rotate-90 animate-bounce" />
        </div>
        <h2 className="text-xl font-black text-white mb-2">Ruota lo Smartphone in Verticale</h2>
        <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
          La navigazione di No Excuses è ottimizzata per la modalità verticale. La modalità orizzontale si attiva automaticamente durante il workout.
        </p>
      </div>
    );
  }

  return null;
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
    <ErrorBoundary>
      {/* Modal globale per il reset password — visibile solo dopo click su link email di recupero */}
      {isPasswordRecovery && <ResetPasswordModal />}
      <Router>
        <OrientationWatcher />
        <ActiveWorkoutBanner />
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
            <ErrorBoundary fallbackTitle="Errore durante l'allenamento">
              <ActiveWorkoutPage />
            </ErrorBoundary>
          </ProtectedRoute>
        } />
        {/* Workout live — rieseguito da uno storico (workoutRunId) */}
        <Route path="/active-workout-history/:workoutRunId" element={
          <ProtectedRoute>
            <ErrorBoundary fallbackTitle="Errore durante l'allenamento">
              <ActiveWorkoutPage />
            </ErrorBoundary>
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        } />
      </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
