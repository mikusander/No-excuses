
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
  const isPrimary = ctaVariant === 'primary';
  const modeLabel = isPrimary ? 'Guided Program' : 'Free Mode';
  const modeDescription = isPrimary
    ? 'Open a saved workout and train with guided flow.'
    : 'Quick counter mode for ad-hoc reps and sets.';
  const ctaClassName =
    isPrimary
      ? 'bg-gradient-to-r from-brand-orange to-brand-lightorange text-black border-black/30 shadow-[0_12px_28px_rgba(179,72,0,0.45)] hover:shadow-[0_18px_36px_rgba(196,90,0,0.6)]'
      : 'bg-black/75 text-white border-brand-orange/40 shadow-[0_10px_24px_rgba(0,0,0,0.45)] hover:border-brand-orange/70';

  return (
    <div className="group relative w-[90%] md:w-[80%] max-w-md mx-auto my-4 overflow-hidden rounded-[30px] border border-white/15 bg-[#111]/80 shadow-[0_20px_45px_rgba(0,0,0,0.45)] transition-transform duration-300 hover:-translate-y-1">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(196,90,0,0.24),transparent_48%)] pointer-events-none" />
      <div className="absolute -left-10 -bottom-14 h-36 w-36 rounded-full bg-brand-orange/10 blur-2xl pointer-events-none" />

      <div className="relative p-4 md:p-5 space-y-4">
        <div className="relative overflow-hidden rounded-2xl border border-white/10">
          <img
            src={imageSrc}
            alt={buttonText}
            className="w-full h-48 md:h-64 object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
          <span className="absolute left-3 top-3 rounded-full border border-brand-orange/35 bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-orange backdrop-blur-md">
            {modeLabel}
          </span>
        </div>

        <p className="text-[12px] md:text-[13px] text-brand-grey/80 leading-relaxed px-1">
          {modeDescription}
        </p>

        <button
          onClick={() => navigate(to)}
          className={`group/cta relative isolate overflow-hidden w-full rounded-2xl border px-6 py-3.5 text-sm md:text-base font-black tracking-[0.04em] uppercase transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2 focus-visible:ring-offset-black ${ctaClassName}`}
        >
          <span className="absolute inset-0 -translate-x-[120%] bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover/cta:translate-x-[120%]" />
          <span className="relative flex items-center justify-center gap-2">
            {buttonText}
            <ArrowRight size={18} className="transition-transform duration-300 group-hover/cta:translate-x-1" />
          </span>
        </button>
      </div>
    </div>
  );
};

export default WorkoutCard;
