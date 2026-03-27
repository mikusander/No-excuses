import { Home, Folder, Settings, Search } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const BottomNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="fixed bottom-6 left-0 w-full flex justify-center items-center px-4 z-50 pointer-events-none">
      
      {/* Container della Tab Bar stile Apple (Blur & Glassmorphism) */}
      <div className="flex items-center space-x-3 pointer-events-auto">
        
        {/* Main Pill Menu */}
        <div className="bg-white/80 backdrop-blur-xl border border-white shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-full flex items-center px-4 py-2 space-x-6">
          <NavItem 
            icon={<Home size={26} strokeWidth={isActive('/') ? 2.5 : 2} />} 
            label="Inizio" 
            active={isActive('/')} 
            onClick={() => navigate('/')} 
          />
          <NavItem 
            icon={<Folder size={26} strokeWidth={isActive('/gym-card') ? 2.5 : 2} />} 
            label="Schede" 
            active={isActive('/gym-card')} 
            onClick={() => navigate('/gym-card')} 
          />
          <NavItem 
            icon={<Settings size={26} strokeWidth={isActive('/settings') ? 2.5 : 2} />} 
            label="Opzioni" 
            active={isActive('/settings')} 
            onClick={() => navigate('/settings')} 
          />
        </div>

        {/* Cerca (Pulsante circolare separato tipico del nuovo iOS) */}
        <button className="bg-white/80 backdrop-blur-xl border border-white shadow-[0_8px_32px_rgba(0,0,0,0.3)] h-[60px] w-[60px] rounded-full flex items-center justify-center text-neutral-800 hover:scale-105 active:scale-95 transition-transform">
          <Search size={26} strokeWidth={2.5} />
        </button>
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
      className="flex flex-col items-center justify-center w-[60px] h-[52px] transition-all hover:scale-105 active:scale-95"
    >
      <div className={`transition-all duration-300 ease-in-out ${active ? 'text-black drop-shadow-md -translate-y-1' : 'text-neutral-500 hover:text-neutral-800'}`}>
        {icon}
      </div>
      <span className={`text-[11px] font-semibold transition-all duration-300 ease-in-out mt-1 ${active ? 'text-black opacity-100' : 'text-neutral-500 opacity-80'}`}>
        {label}
      </span>
      {/* Piccolo pallino di indicazione che compare sotto per la pagina attiva */}
      <div className={`w-1 h-1 rounded-full bg-black mt-1 transition-all duration-300 ease-in-out ${active ? 'opacity-100 scale-100' : 'opacity-0 scale-0 hidden'}`} />
    </button>
  );
};

export default BottomNavigation;
