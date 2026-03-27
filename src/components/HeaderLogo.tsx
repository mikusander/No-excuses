

const HeaderLogo: React.FC = () => {
  return (
    <header className="w-full flex justify-center items-center py-6 mt-4">
      <div className="relative">
        {/* We use the logo image directly since it matches the mockup perfectly */}
        <img 
          src="/images/logoApp.jpeg" 
          alt="No Excuses Logo" 
          className="h-20 md:h-24 rounded-2xl border-2 border-white object-contain"
        />
      </div>
    </header>
  );
};

export default HeaderLogo;
