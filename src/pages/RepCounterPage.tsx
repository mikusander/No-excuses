
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const RepCounterPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col">
      {/* Top Header */}
      <header className="p-4 flex items-center bg-black/50">
        <button 
          onClick={() => navigate('/')} 
          className="p-2 text-white hover:text-brand-orange transition-colors"
        >
          <ArrowLeft size={28} />
        </button>
        <h1 className="text-xl font-bold ml-4">Reps Counter</h1>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 relative">
        <div className="w-full max-w-md aspect-[3/4] bg-brand-darkGrey rounded-3xl border-4 border-brand-orange flex items-center justify-center overflow-hidden relative">
          <p className="text-brand-grey text-center px-4">
            [Camera View Placeholder]<br/><br/>
            In the future, MediaPipe tasks-vision will be initialized here and draw skeletal landmarks on a canvas overlaid on the video feed.
          </p>
        </div>

        {/* Counter UI */}
        <div className="mt-8 bg-black/60 px-12 py-6 rounded-full border-2 border-brand-lightOrange shadow-[0_0_15px_rgba(196,90,0,0.5)]">
          <p className="text-6xl font-black text-white text-center">0</p>
          <p className="text-brand-orange font-semibold tracking-widest uppercase mt-1">Reps</p>
        </div>
      </main>
    </div>
  );
};

export default RepCounterPage;
