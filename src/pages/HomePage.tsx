import HeaderLogo from '../components/HeaderLogo';
import WorkoutCard from '../components/WorkoutCard';
import BottomNavigation from '../components/BottomNavigation';
import { useAuth } from '../context/AuthContext';
import { LogOut } from 'lucide-react';

const HomePage = () => {
  const { user, signOut } = useAuth();

  return (
    <div className="pb-24 flex flex-col items-center relative min-h-screen">
      {/* Intestazione con pulsante logout testuale per debug o uso rapido */}
      {user && (
        <button 
          onClick={signOut}
          className="absolute top-6 right-4 text-brand-grey hover:text-brand-orange flex items-center space-x-1"
        >
          <LogOut size={20} />
          <span className="text-sm font-semibold">Esci</span>
        </button>
      )}

      <HeaderLogo />
      
      <main className="w-full flex flex-col items-center mt-4 space-y-8">
        
        {user && (
          <div className="text-center w-full px-6">
            <p className="text-brand-grey text-lg">
              Bentornato,<br />
              <span className="text-brand-orange font-bold text-xl">{user.email?.split('@')[0]}</span>!
            </p>
          </div>
        )}

        <WorkoutCard
          imageSrc="/images/download.jpeg"
          buttonText="START NEW TRAIN"
          to="/new-train"
        />

        <WorkoutCard
          imageSrc="/images/download (1).jpeg"
          buttonText="START REPS COUNT"
          to="/reps-count"
        />
      </main>

      <BottomNavigation />
    </div>
  );
};

export default HomePage;
