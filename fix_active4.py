import re

with open('src/pages/ActiveWorkoutPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Update JSX Display for timer title in EMOM
pattern = r'\{isResting \?\s*\'RECUPERO\'\s*:\s*currentExercise\.type === \'emom\' \|\| currentExercise\.type === \'isometria\' \|\| \(\(currentExercise\.type === \'superset\' \|\| currentExercise\.type === \'ripetizioni\'\) && isSetCompleted\)\s*\? \'IN CORSO\'\s*:\s*\'PRONTO\?\'\s*\}'

repl = '''{isResting ? 
                'RECUPERO' 
              : currentExercise.type === 'emom' || currentExercise.type === 'isometria' || ((currentExercise.type === 'superset' || currentExercise.type === 'ripetizioni') && isSetCompleted) 
                ? (currentExercise.type === 'emom' && !isResting ? 'ROUND IN CORSO' : 'IN CORSO') 
                : 'PRONTO?'
              }'''
text = re.sub(pattern, repl, text)

with open('src/pages/ActiveWorkoutPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
