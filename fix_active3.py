import re

with open('src/pages/ActiveWorkoutPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Update JSX Display in the ActiveWorkoutPage
# find: {currentSetIdx + 1} / {currentExercise.sets || 1}
# for EMOM we should probably show Set X / Y and Round A / B

pattern_jsx = r'Set\s*<span className="font-bold text-teal-accent ml-2">\s*\{currentSetIdx \+ 1\} / \{currentExercise\.sets \|\| 1\}\s*</span>'
repl_jsx = '''{currentExercise.type === 'emom' ? (
              <div className="flex flex-col items-center">
                <span>
                  Set <span className="font-bold text-teal-accent ml-2">
                    {currentSetIdx + 1} / {currentExercise.sets || 1}
                  </span>
                </span>
                <span className="text-xl mt-1">
                  Round <span className="font-bold text-teal-accent ml-2">
                    {currentEmomRoundIdx + 1} / {currentExercise.emom_rounds || 1}
                  </span>
                </span>
              </div>
            ) : (
              <span>
                Set <span className="font-bold text-teal-accent ml-2">
                  {currentSetIdx + 1} / {currentExercise.sets || 1}
                </span>
              </span>
            )}'''
text = re.sub(pattern_jsx, repl_jsx, text)

with open('src/pages/ActiveWorkoutPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
