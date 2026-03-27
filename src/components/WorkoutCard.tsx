
import { useNavigate } from 'react-router-dom';

interface WorkoutCardProps {
  imageSrc: string;
  buttonText: string;
  to: string;
}

const WorkoutCard: React.FC<WorkoutCardProps> = ({ imageSrc, buttonText, to }) => {
  const navigate = useNavigate();

  return (
    <div className="bg-brand-grey rounded-3xl w-[90%] md:w-[80%] max-w-md mx-auto my-4 p-4 flex flex-col items-center">
      <img 
        src={imageSrc} 
        alt={buttonText} 
        className="w-full h-48 md:h-64 object-cover rounded-xl mb-6"
      />
      <button 
        onClick={() => navigate(to)}
        className="bg-brand-orange hover:bg-brand-lightOrange text-black font-semibold text-lg py-3 px-8 rounded-full w-[90%] transition-colors duration-200"
      >
        {buttonText}
      </button>
    </div>
  );
};

export default WorkoutCard;
