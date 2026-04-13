import { useState } from 'react';
import WorkoutConfig from './components/WorkoutConfig';
import WorkoutSession from './components/WorkoutSession';
import Summary from './components/Summary';
import type { WorkoutConfig as IWorkoutConfig, AppState } from './types';

function App() {
  const [appState, setAppState] = useState<AppState>('config');
  const [config, setConfig] = useState<IWorkoutConfig>({ pullupsCount: 10, pushupsCount: 20, squatsCount: 30 });

  const handleStart = (newConfig: IWorkoutConfig) => {
    setConfig(newConfig);
    setAppState('workout');
  };

  const handleFinish = () => {
    setAppState('summary');
  };

  const handleRestart = () => {
    setAppState('config');
  };

  return (
    <div className="min-h-screen bg-[#0c0c0e] text-white selection:bg-primary/30">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {appState === 'config' && (
          <WorkoutConfig onStart={handleStart} />
        )}
        
        {appState === 'workout' && (
          <WorkoutSession 
            config={config} 
            onFinish={handleFinish} 
            onBack={handleRestart}
          />
        )}

        {appState === 'summary' && (
          <Summary 
            config={config} 
            onRestart={handleRestart} 
          />
        )}
      </main>
      
      {/* Background blobs for premium feel */}
      <div className="fixed top-0 left-0 w-full h-full -z-10 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary blur-[120px] rounded-full animate-pulse delay-700" />
      </div>
    </div>
  );
}

export default App;
