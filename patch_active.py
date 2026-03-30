import re

with open('c:/Users/MICHELANGELO/No-excuses/active_workout_code.txt', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update interface
text = text.replace(
"""interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset';""",
"""interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom';
  emom_rounds?: number;
  emom_round_duration?: number;"""
)

# 2. Add timers
state_hook = """  // Timer State for Isometry
  const [isometryActive, setIsometryActive] = useState(false);
  const [isometryRemaining, setIsometryRemaining] = useState(0);"""
new_state_hook = state_hook + "\n\n  // Timer State for EMOM\n  const [emomActive, setEmomActive] = useState(false);\n  const [emomRoundRemaining, setEmomRoundRemaining] = useState(0);\n  const [currentEmomRoundIdx, setCurrentEmomRoundIdx] = useState(0);"

text = text.replace(state_hook, new_state_hook)

# 3. Add to handleVoiceNextRef
next_ref = """  handleVoiceNextRef.current = () => {
    if (isResting) skipRest();
    else completeSet();
  };"""
new_next_ref = """  handleVoiceNextRef.current = () => {
    if (isResting) skipRest();
    else if (workout?.exercises[currentExerciseIdx]?.type === 'emom') {
      const ex = workout.exercises[currentExerciseIdx];
      if (currentEmomRoundIdx < (ex.emom_rounds || 1) - 1) {
        setCurrentEmomRoundIdx(prev => prev + 1);
        setEmomRoundRemaining(ex.emom_round_duration || 60);
      } else {
        setEmomActive(false);
        if (currentSetIdx === ex.sets - 1) {
          handleNextExercise();
        } else {
          setRestRemaining(ex.rest_seconds);
          setIsResting(true);
        }
      }
    }
    else completeSet();
  };"""
text = text.replace(next_ref, new_next_ref)

# 4. Modify handleVoicePrevRef
prev_ref = """  handleVoicePrevRef.current = () => {
    // Granular 'back' functionality perfectly mirroring 'next'
    if (!workout) return;
    const currentEx = workout.exercises[currentExerciseIdx];

    if (isResting) {"""
new_prev_ref = """  handleVoicePrevRef.current = () => {
    // Granular 'back' functionality perfectly mirroring 'next'
    if (!workout) return;
    const currentEx = workout.exercises[currentExerciseIdx];

    if (currentEx.type === 'emom') {
      if (currentEmomRoundIdx > 0) {
        setCurrentEmomRoundIdx(prev => prev - 1);
        setEmomRoundRemaining(currentEx.emom_round_duration || 60);
      } else {
        handlePrevExercise();
      }
      return;
    }

    if (isResting) {"""
text = text.replace(prev_ref, new_prev_ref)

# 5. Add voice commands vai/go/stop/fermo
voice_cmd = """          if (transcript.includes('next') || transcript.includes('avanti')) {"""
new_voice_cmd = """          if (transcript.includes('vai') || transcript.includes('go')) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (workout?.exercises[currentExerciseIdx]?.type === 'emom') setEmomActive(true);
            else setIsometryActive(true);
          } else if (transcript.includes('stop') || transcript.includes('fermo')) {
             setVoiceStatus('success');
             setTimeout(() => setVoiceStatus('idle'), 1500);
             if (workout?.exercises[currentExerciseIdx]?.type === 'emom') setEmomActive(false);
             else setIsometryActive(false);
          } else if (transcript.includes('next') || transcript.includes('avanti')) {"""
text = text.replace(voice_cmd, new_voice_cmd)

# 6. Parse EMOM in fetchWorkout
parse_old = """        // Parsing superset JSON
        sortedExercises = sortedExercises.map(ex => {
          let parsedName = ex.name;
          let subExercises = undefined;
          if (ex.type === 'superset') {
            try {
              subExercises = JSON.parse(ex.name);
              parsedName = 'Superset Circuit'; 
            } catch(e) {}
          }"""
parse_new = """        // Parsing superset JSON
        sortedExercises = sortedExercises.map(ex => {
          let parsedName = ex.name;
          let subExercises = undefined;
          if (ex.type === 'superset') {
            try {
              subExercises = JSON.parse(ex.name);
              parsedName = 'Superset Circuit'; 
            } catch(e) {}
          } else if (ex.type === 'emom') {
            try {
              const parsed = JSON.parse(ex.name);
              subExercises = parsed.subExercises;
              ex.emom_rounds = parsed.emom_rounds;
              ex.emom_round_duration = parsed.emom_round_duration;
              parsedName = 'EMOM Circuit';
            } catch(e) {}
          }"""
text = text.replace(parse_old, parse_new)

# 7. init EMOM in fetchWorkout
first_ex_old = """        const firstEx = sortedExercises[0];
        if (firstEx) {
          if (firstEx.type === 'isometry') {
              setIsometryRemaining(firstEx.duration_seconds);
          } else if (firstEx.type === 'superset' && firstEx.subExercises?.[0]?.type === 'isometry') {
              setIsometryRemaining(firstEx.subExercises[0].duration_seconds);
          }
        }"""
first_ex_new = """        const firstEx = sortedExercises[0];
        if (firstEx) {
          if (firstEx.type === 'isometry') {
              setIsometryRemaining(firstEx.duration_seconds);
          } else if (firstEx.type === 'superset' && firstEx.subExercises?.[0]?.type === 'isometry') {
              setIsometryRemaining(firstEx.subExercises[0].duration_seconds);
          } else if (firstEx.type === 'emom') {
              setEmomRoundRemaining(firstEx.emom_round_duration || 60);
          }
        }"""
text = text.replace(first_ex_old, first_ex_new)

# 8. EMOM timer loop
iso_loop_old = """  // Timer logic for ISOMETRY
  useEffect(() => {"""
emom_loop = """  // Timer logic for EMOM
  useEffect(() => {
    if (emomActive && emomRoundRemaining > 0) {
      timerRef.current = setInterval(() => {
        setEmomRoundRemaining((prev) => prev - 1);
      }, 1000);
    } else if (emomActive && emomRoundRemaining <= 0) {
      const ex = workout?.exercises[currentExerciseIdx];
      if (ex && ex.type === 'emom') {
        if (currentEmomRoundIdx < (ex.emom_rounds || 1) - 1) {
          setCurrentEmomRoundIdx(prev => prev + 1);
          setEmomRoundRemaining(ex.emom_round_duration || 60);
        } else {
          setEmomActive(false);
          const isLSet = currentSetIdx === ex.sets - 1;
          if (isLSet) {
             handleNextExercise();
          } else {
             setRestRemaining(ex.rest_seconds);
             setIsResting(true);
          }
        }
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [emomActive, emomRoundRemaining, currentEmomRoundIdx, workout, currentExerciseIdx, currentSetIdx]);

  // Timer logic for ISOMETRY
  useEffect(() => {"""
text = text.replace(iso_loop_old, emom_loop)

# 9. Next / Prev states reset
next_ex_old = """      setCurrentSubExerciseIdx(0);
      setIsResting(false);
      setIsometryActive(false);
      setIsometryRemaining(getTargetIsometry(nextEx, nextEx.subExercises?.[0]));
    } else {"""
next_ex_new = """      setCurrentSubExerciseIdx(0);
      setCurrentEmomRoundIdx(0);
      setEmomActive(false);
      setIsResting(false);
      setIsometryActive(false);
      setIsometryRemaining(getTargetIsometry(nextEx, nextEx.subExercises?.[0]));
      if (nextEx.type === 'emom') setEmomRoundRemaining(nextEx.emom_round_duration || 60);
    } else {"""
text = text.replace(next_ex_old, next_ex_new)

prev_ex_old = """      setCurrentSubExerciseIdx(0);
      setIsResting(false);
      setIsometryActive(false);
      setIsometryRemaining(getTargetIsometry(prevEx, prevEx.subExercises?.[0]));
    }
  };"""
prev_ex_new = """      setCurrentSubExerciseIdx(0);
      setCurrentEmomRoundIdx(0);
      setEmomActive(false);
      setIsResting(false);
      setIsometryActive(false);
      setIsometryRemaining(getTargetIsometry(prevEx, prevEx.subExercises?.[0]));
      if (prevEx.type === 'emom') setEmomRoundRemaining(prevEx.emom_round_duration || 60);
    }
  };"""
text = text.replace(prev_ex_old, prev_ex_new)

# Finish Rest state update
fin_old = """    setCurrentSubExerciseIdx(0);
    
    // Reset isometry timer if needed
    setIsometryRemaining(getTargetIsometry(currentExercise, currentExercise.subExercises?.[0]));
  };"""
fin_new = """    setCurrentSubExerciseIdx(0);
    setCurrentEmomRoundIdx(0);
    if (currentExercise.type === 'emom') setEmomRoundRemaining(currentExercise.emom_round_duration || 60);
    
    // Reset isometry timer if needed
    setIsometryRemaining(getTargetIsometry(currentExercise, currentExercise.subExercises?.[0]));
  };"""
text = text.replace(fin_old, fin_new)

# Render EMOM
render_info_old = """             {isSuperset && (
               <span className="text-[10px] text-brand-orange/60 uppercase font-black tracking-widest block mt-1">
                 Superset (Exercise {currentSubExerciseIdx + 1} of {currentExercise.subExercises?.length})
               </span>
             )}"""
render_info_new = """             {isSuperset && (
               <span className="text-[10px] text-brand-orange/60 uppercase font-black tracking-widest block mt-1">
                 Superset (Exercise {currentSubExerciseIdx + 1} of {currentExercise.subExercises?.length})
               </span>
             )}
             {currentExercise.type === 'emom' && (
               <span className="text-[10px] text-blue-400 uppercase font-black tracking-widest block mt-1">
                 Round {currentEmomRoundIdx + 1} of {currentExercise.emom_rounds}
               </span>
             )}"""
text = text.replace(render_info_old, render_info_new)

iso_render_old = """        {/* Focus Area (Reps / Timer) */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {(isSuperset ? subExercise?.type : currentExercise.type) === 'isometry' ? ("""
emom_render_new = """        {/* Focus Area (Reps / Timer / EMOM) */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {currentExercise.type === 'emom' ? (
            <div className="text-center w-full max-w-sm flex flex-col items-center">
              <div className={`w-48 h-48 mx-auto rounded-full border-[10px] flex flex-col justify-center items-center transition-colors duration-300 shadow-xl cursor-pointer ${emomActive ? 'border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.4)]' : 'border-brand-darkGrey'}`}
                   onClick={() => setEmomActive(!emomActive)}>
                 <span className={`text-[60px] font-mono tracking-tighter ${emomActive ? 'text-white' : 'text-brand-grey'} transition-colors leading-none`}>
                   {emomRoundRemaining}
                 </span>
                 <span className="text-brand-grey font-bold uppercase tracking-widest text-[10px] mt-1">SEC LEFT</span>
                 <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 rounded-full transition-opacity">
                    {emomActive ? <Pause size={48} className="text-white"/> : <Play size={48} className="text-white"/>}
                 </div>
              </div>
              <p className="text-center text-[10px] text-brand-grey mt-2 uppercase tracking-wider font-bold mb-4">
                Tap timer or say '{emomActive ? 'stop' : 'vai'}'
              </p>
              
              {/* EMOM Tasks */}
              <div className="w-full flex-1 max-h-[25vh] overflow-y-auto space-y-2 px-2">
                {currentExercise.subExercises?.map((sub, idx) => (
                  <div key={idx} className="bg-brand-darkGrey/30 p-3 rounded-xl border border-white/5 flex justify-between items-center">
                    <span className="text-white font-bold text-sm truncate max-w-[70%] text-left">{sub.name}</span>
                    <span className="text-blue-400 font-mono font-black text-sm">
                      {sub.type === 'reps' ? `${sub.reps} REPS` : `${sub.duration_seconds}s`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (isSuperset ? subExercise?.type : currentExercise.type) === 'isometry' ? ("""
text = text.replace(iso_render_old, emom_render_new)

# Finally button logic for EMOM
button_old = """             ) : isLastSet ? (
               <>NEXT EXERCISE <ArrowRight size={24} className="ml-2" /></>
             ) : (
               <>FINISH {isSuperset ? 'ROUND' : 'SET'}</>
             )}
          </button>"""
button_new = """             ) : currentExercise.type === 'emom' ? (
               <>SKIP TO NEXT ROUND <ArrowRight size={24} className="ml-2" /></>
             ) : isLastSet ? (
               <>NEXT EXERCISE <ArrowRight size={24} className="ml-2" /></>
             ) : (
               <>FINISH {isSuperset ? 'ROUND' : 'SET'}</>
             )}
          </button>"""
text = text.replace(button_old, button_new)


# Now fix completeSet for EMOM when button is pressed
cmp_old = """  const completeSet = () => {
    // Se siamo dentro a un superset e non abbiamo finito i sub-esercizi
    if (isSuperset && currentExercise.subExercises && currentSubExerciseIdx < currentExercise.subExercises.length - 1) {"""
cmp_new = """  const completeSet = () => {
    if (currentExercise.type === 'emom') {
      // Skipping round manually via button
      if (currentEmomRoundIdx < (currentExercise.emom_rounds || 1) - 1) {
        setCurrentEmomRoundIdx(prev => prev + 1);
        setEmomRoundRemaining(currentExercise.emom_round_duration || 60);
      } else {
        setEmomActive(false);
        if (isLastSet) handleNextExercise();
        else { setRestRemaining(currentExercise.rest_seconds); setIsResting(true); }
      }
      return;
    }

    // Se siamo dentro a un superset e non abbiamo finito i sub-esercizi
    if (isSuperset && currentExercise.subExercises && currentSubExerciseIdx < currentExercise.subExercises.length - 1) {"""
text = text.replace(cmp_old, cmp_new)


with open('c:/Users/MICHELANGELO/No-excuses/src/pages/ActiveWorkoutPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
print('Patch complete!')
