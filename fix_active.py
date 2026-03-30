import re

with open('src/pages/ActiveWorkoutPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Add state
text = re.sub(r'const \[emomRoundRemaining, setEmomRoundRemaining\] = useState\(0\);', 'const [emomRoundRemaining, setEmomRoundRemaining] = useState(0);\n    const [currentEmomRoundIdx, setCurrentEmomRoundIdx] = useState(0);', text)
text = re.sub(r'const \[currentSetIdx, setCurrentSetIdx\] = useState\(0\);', 'const [currentSetIdx, setCurrentSetIdx] = useState(0);', text) # just to check

# Fix parsing
pattern_parse = r'\} else if \(ex\.type === \'emom\'\) \{\s*try \{\s*const parsed = JSON\.parse\(ex\.name\);\s*if \(Array\.isArray\(parsed\)\) \{\s*subExercises = parsed;\s*\} else if \(parsed && parsed\.subExercises\) \{\s*subExercises = parsed\.subExercises;\s*ex\.sets = parsed\.emom_rounds \|\| ex\.sets;\s*ex\.duration_seconds = parsed\.emom_round_duration \|\| ex\.duration_seconds;\s*\}'
repl_parse = '''} else if (ex.type === 'emom') {
              try {
                const parsed = JSON.parse(ex.name);
                if (Array.isArray(parsed)) {
                  subExercises = parsed;
                } else if (parsed && parsed.subExercises) {
                  subExercises = parsed.subExercises;
                  ex.emom_rounds = parsed.emom_rounds;
                  ex.emom_round_duration = parsed.emom_round_duration;
                }'''
text = re.sub(pattern_parse, repl_parse, text)

# Fix handleVoiceNextRef
pattern_voice_next = r'if \(workout\?\.exercises\[currentExerciseIdx\]\?\.type === \'emom\'\) \{\s*const ex = workout\.exercises\[currentExerciseIdx\];\s*if \(currentSetIdx < \(ex\.sets \|\| 1\) - 1\) \{\s*setCurrentSetIdx\(prev => prev \+ 1\);\s*setEmomRoundRemaining\(ex\.duration_seconds \|\| 60\);\s*\} else \{\s*setEmomActive\(false\);\s*if \(currentSetIdx === ex\.sets - 1\) \{\s*handleNextExercise\(\);\s*\} else \{\s*setRestRemaining\(ex\.rest_seconds\);\s*setIsResting\(true\);\s*\}\s*\}\s*return;\s*\}'
repl_voice_next = '''if (workout?.exercises[currentExerciseIdx]?.type === 'emom') {
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
        return;
      }'''
text = re.sub(pattern_voice_next, repl_voice_next, text)

# Fix handleVoicePrevRef
pattern_voice_prev = r'if \(currentEx\.type === \'emom\'\) \{\s*if \(currentSetIdx > 0\) \{\s*setCurrentSetIdx\(prev => prev - 1\);\s*setEmomRoundRemaining\(currentEx\.duration_seconds \|\| 60\);\s*\} else \{\s*handlePrevExercise\(\);\s*\}\s*return;\s*\}'
repl_voice_prev = '''if (currentEx.type === 'emom') {
        if (currentEmomRoundIdx > 0) {
          setCurrentEmomRoundIdx(prev => prev - 1);
          setEmomRoundRemaining(currentEx.emom_round_duration || 60);
        } else {
          handlePrevExercise();
        }
        return;
      }'''
text = re.sub(pattern_voice_prev, repl_voice_prev, text)

# Fix completeSet
pattern_complete = r'if \(currentExercise\.type === \'emom\'\) \{\s*// Skipping round manually via button\s*if \(currentSetIdx < \(currentExercise\.sets \|\| 1\) - 1\) \{\s*setCurrentSetIdx\(prev => prev \+ 1\);\s*setEmomRoundRemaining\(currentExercise\.duration_seconds \|\| 60\);\s*\} else \{\s*setEmomActive\(false\);\s*if \(isLastSet\) handleNextExercise\(\);\s*else \{ setRestRemaining\(currentExercise\.rest_seconds\);\s*setIsResting\(true\); \}\s*\}\s*return;\s*\}'
repl_complete = '''if (currentExercise.type === 'emom') {
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
      }'''
text = re.sub(pattern_complete, repl_complete, text)

# Fix timer logic EMOM
pattern_timer = r'if \(ex && ex\.type === \'emom\'\) \{\s*if \(currentSetIdx < \(ex\.sets \|\| 1\) - 1\) \{\s*setCurrentSetIdx\(prev => prev \+ 1\);\s*setEmomRoundRemaining\(ex\.duration_seconds \|\| 60\);\s*\} else \{\s*setEmomActive\(false\);\s*const isLSet = currentSetIdx === ex\.sets - 1;\s*if \(isLSet\) \{\s*handleNextExercise\(\);\s*\} else \{\s*setRestRemaining\(ex\.rest_seconds\);\s*setIsResting\(true\);\s*\}\s*\}'
repl_timer = '''if (ex && ex.type === 'emom') {
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
          }'''
text = re.sub(pattern_timer, repl_timer, text)

with open('src/pages/ActiveWorkoutPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
