/**
 * HomePage.tsx — Schermata principale dell'applicazione.
 *
 * Punto di atterraggio dopo il login. Mostra le WorkoutCard per accedere alle
 * modalità di allenamento (Guided Program e Free Mode).
 *
 * Gli allenamenti lasciati in sospeso/background sono gestiti globalmente
 * tramite il componente ActiveWorkoutBanner (barra fluttuante in alto),
 * con opzione di ripresa immediata o annullamento esplicito.
 */
import HeaderLogo from '../components/HeaderLogo';
import WorkoutCard from '../components/WorkoutCard';
import BottomNavigation from '../components/BottomNavigation';

const HomePage = () => {
  return (
    <div className="safe-pb-nav flex flex-col items-center relative min-h-screen">
      <HeaderLogo />

      <main className="w-full flex flex-col items-center mt-4 space-y-8">
        {/* Card modalità guidata (Guided Program) — animazione delay 1 */}
        <div className="w-full flex justify-center animate-home-card animate-home-card-delay-1">
          <WorkoutCard
            imageSrc="/images/download.jpeg"
            buttonText="START NEW TRAIN"
            to="/select-workout"
            ctaVariant="primary"
          />
        </div>

        {/* Card modalità libera (Free Mode) — animazione delay 2 */}
        <div className="w-full flex justify-center animate-home-card animate-home-card-delay-2">
          <WorkoutCard
            imageSrc="/images/download (1).jpeg"
            buttonText="START REPS COUNT"
            to="/reps-count"
            ctaVariant="secondary"
          />
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
};

export default HomePage;
