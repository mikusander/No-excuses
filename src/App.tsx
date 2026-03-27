
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RepCounterPage from './pages/RepCounterPage';
import BottomNavigation from './components/BottomNavigation';

const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="min-h-screen flex flex-col bg-brand-dark">
    <div className="flex-1 flex items-center justify-center text-brand-grey text-2xl text-center px-4">
      {title} Page<br/><span className="text-sm mt-2 block">(Coming Soon)</span>
    </div>
    <BottomNavigation />
  </div>
);

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/reps-count" element={<RepCounterPage />} />
        <Route path="/new-train" element={<PlaceholderPage title="New Train" />} />
        <Route path="/gym-card" element={<PlaceholderPage title="Gym Card" />} />
        <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
      </Routes>
    </Router>
  );
}

export default App;
