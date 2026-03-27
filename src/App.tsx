import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RepCounterPage from './pages/RepCounterPage';
import BottomNavigation from './components/BottomNavigation';
import AuthPage from './pages/AuthPage';
import NewTrainPage from './pages/NewTrainPage';
import GymCardPage from './pages/GymCardPage';
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

const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="min-h-screen flex flex-col bg-brand-dark">
    <div className="flex-1 flex items-center justify-center text-brand-grey text-2xl text-center px-4">
      {title} Page<br/><span className="text-sm mt-2 block">(Work in progress)</span>
    </div>
    <BottomNavigation />
  </div>
);

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
        <Route path="/gym-card" element={
          <ProtectedRoute>
            <GymCardPage />
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute>
            <PlaceholderPage title="Settings" />
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
  );
}

export default App;
