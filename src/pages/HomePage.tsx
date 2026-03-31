import HeaderLogo from '../components/HeaderLogo';
import WorkoutCard from '../components/WorkoutCard';
import BottomNavigation from '../components/BottomNavigation';

const HomePage = () => {
  return (
    <div className="pb-24 flex flex-col items-center relative min-h-screen">
      <HeaderLogo />
      
      <main className="w-full flex flex-col items-center mt-4 space-y-8">
        <div className="w-full flex justify-center animate-home-card animate-home-card-delay-1">
          <WorkoutCard
            imageSrc="/images/download.jpeg"
            buttonText="START NEW TRAIN"
            to="/select-workout"
            ctaVariant="primary"
          />
        </div>

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
