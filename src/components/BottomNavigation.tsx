
import { Home, Folder, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

const BottomNavigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-brand-darkGrey rounded-full flex justify-between items-center px-6 py-3 shadow-lg z-50">
      <NavItem 
        icon={<Home size={28} />} 
        label="HOME" 
        active={isActive('/')} 
        onClick={() => navigate('/')} 
      />
      <NavItem 
        icon={<Folder size={28} />} 
        label="GYM CARD" 
        active={isActive('/gym-card')} 
        onClick={() => navigate('/gym-card')} 
      />
      <NavItem 
        icon={<Settings size={28} />} 
        label="SETTINGS" 
        active={isActive('/settings')} 
        onClick={() => navigate('/settings')} 
      />
    </div>
  );
};

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick }) => {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-2 rounded-xl transition-colors ${active ? 'text-brand-orange bg-black/20' : 'text-brand-grey hover:text-white'}`}
    >
      <div className="bg-transparent border-2 border-current rounded-lg p-1 mb-1">
        {icon}
      </div>
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  );
};

export default BottomNavigation;
