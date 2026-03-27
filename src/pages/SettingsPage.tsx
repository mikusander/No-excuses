import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, User } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import HeaderLogo from '../components/HeaderLogo';

const SettingsPage: React.FC = () => {
  const { user, signOut } = useAuth();
  
  const userName = user?.email?.split('@')[0] || 'Utente';

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <HeaderLogo />

      <main className="flex-1 w-full flex flex-col items-center px-6 mt-6">
        {/* User Info Section */}
        <div className="bg-brand-darkGrey/40 w-full max-w-sm rounded-3xl p-6 flex flex-col items-center border border-brand-grey/20">
          <div className="bg-brand-orange/20 p-4 rounded-full mb-4">
            <User className="text-brand-orange" size={40} />
          </div>
          <h2 className="text-2xl font-bold text-white capitalize">{userName}</h2>
          <p className="text-sm text-brand-grey mt-1">{user?.email}</p>
        </div>

        {/* Spazio per future impostazioni */}
        <div className="w-full max-w-sm mt-8 space-y-4">
          <div className="bg-brand-darkGrey/20 border border-brand-grey/10 rounded-2xl p-4 text-center">
            <p className="text-brand-grey/60 text-sm">Altre opzioni in arrivo...</p>
          </div>
        </div>

        {/* Logout Button pushed to the end */}
        <div className="mt-auto w-full max-w-sm pt-12">
          <button 
            onClick={signOut}
            className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 font-bold text-lg py-4 rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-red-500/5"
          >
            <LogOut size={24} className="mr-2" />
            ESCI DALL'ACCOUNT
          </button>
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
};

export default SettingsPage;
