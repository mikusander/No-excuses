
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

interface WorkoutCardProps {
  imageSrc: string;
  buttonText: string;
  to: string;
  ctaVariant?: 'primary' | 'secondary';
}

const WorkoutCard: React.FC<WorkoutCardProps> = ({ imageSrc, buttonText, to, ctaVariant = 'primary' }) => {
  const navigate = useNavigate();
  const ctaClassName =
    ctaVariant === 'primary'
      ? 'bg-gradient-to-r from-brand-orange to-brand-lightorange text-black border-black/30 shadow-[0_10px_26px_rgba(179,72,0,0.45)] hover:shadow-[0_14px_32px_rgba(196,90,0,0.55)]'
      : 'bg-black/80 text-brand-grey border-brand-orange/40 shadow-[0_10px_26px_rgba(0,0,0,0.5)] hover:border-brand-orange/70 hover:text-white';

  return (
    <div className="bg-brand-grey rounded-3xl w-[90%] md:w-[80%] max-w-md mx-auto my-4 p-4 flex flex-col items-center border border-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
      <img 
        src={imageSrc} 
        alt={buttonText} 
        className="w-full h-48 md:h-64 object-cover rounded-xl mb-6"
      />
      <button 
        onClick={() => navigate(to)}
        className={`group relative overflow-hidden w-[90%] rounded-2xl border px-6 py-3.5 text-sm md:text-base font-black tracking-[0.04em] uppercase transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2 focus-visible:ring-offset-brand-grey ${ctaClassName}`}
      >
        <span className="flex items-center justify-center gap-2">
          {buttonText}
          <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </button>
    </div>
  );
};

export default WorkoutCard;
