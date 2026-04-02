import { Home, Folder, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const historyIconMaskStyle = {
  WebkitMaskImage: "url('/images/icons8-passato-100.png')",
  maskImage: "url('/images/icons8-passato-100.png')",
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  backgroundColor: 'currentColor',
};

const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const isHomeActive = isActive('/');
  const isGymCardActive = isActive('/gym-card');
  const isHistoryActive = location.pathname.startsWith('/workout-history');
  const isSettingsActive = isActive('/settings');

  return (
    <div className="fixed bottom-6 left-0 w-full flex justify-center items-center px-4 z-50 pointer-events-none">

      {/* Container della Tab Bar stile Apple (Blur & Glassmorphism) */}
      <div className="flex items-center space-x-3 pointer-events-auto">

        {/* Main Pill Menu - Liquid Glassmorphism */}
        <div className="bg-[#1C1C1E]/60 backdrop-blur-[32px] saturate-[1.5] border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] rounded-full flex items-center px-2 py-1.5 space-x-1 relative overflow-hidden">

          {/* Subtle liquid glow layer inside the bar */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-50 pointer-events-none" />

          <NavItem
            icon={<Home size={24} strokeWidth={isHomeActive ? 2.5 : 2} />}
            label="Home"
            active={isHomeActive}
            onClick={() => navigate('/')}
          />
          <NavItem
            icon={<Folder size={24} strokeWidth={isGymCardActive ? 2.5 : 2} />}
            label="Gym Card"
            active={isGymCardActive}
            onClick={() => navigate('/gym-card')}
          />
          <NavItem
            icon={<span className="block w-6 h-6" style={historyIconMaskStyle} />}
            label="History"
            active={isHistoryActive}
            onClick={() => navigate('/workout-history')}
          />
          <NavItem
            icon={<Settings size={24} strokeWidth={isSettingsActive ? 2.5 : 2} />}
            label="Settings"
            active={isSettingsActive}
            onClick={() => navigate('/settings')}
          />
        </div>
      </div>
    </div>
  );
};

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavItem = ({ icon, label, active, onClick }: NavItemProps) => {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center w-[72px] sm:w-[84px] h-[64px] rounded-3xl transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] z-10 overflow-hidden ${active ? 'bg-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]' : 'hover:bg-white/5'}`}
    >
      {/* Animated Glow Behind Icon */}
      <div
        className={`absolute inset-0 bg-brand-orange/20 blur-xl transition-all duration-700 ease-out rounded-full 
        ${active ? 'opacity-100 scale-150' : 'opacity-0 scale-50'}`}
      />

      <div className={`relative z-10 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${active ? 'text-brand-orange -translate-y-2.5 scale-110 drop-shadow-[0_0_12px_rgba(255,107,0,0.6)]' : 'text-brand-grey/60 hover:text-white/90'}`}>
        {icon}
      </div>

      <span
        className={`absolute bottom-2 text-[9px] font-black uppercase tracking-wide whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] 
        ${active ? 'text-brand-orange opacity-100 translate-y-0 drop-shadow-[0_0_8px_rgba(255,107,0,0.4)]' : 'text-brand-grey/40 opacity-0 translate-y-4'}`}
      >
        {label}
      </span>

      {/* Liquid Dot Indicator */}
      <div
        className={`absolute bottom-0 w-6 h-1 rounded-t-full bg-brand-orange transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[0_0_10px_rgba(255,107,0,1)] 
        ${active ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      />
    </button>
  );
};

export default BottomNavigation;
