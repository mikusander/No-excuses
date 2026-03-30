import re

with open('src/pages/ActiveWorkoutPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# fix handleNextExercise
pattern = r'const handleNextExercise = \(\) => \{\s*setCurrentSetIdx\(0\);\s*setRestRemaining\(0\);\s*setIsResting\(false\);'
repl = '''const handleNextExercise = () => {
    setCurrentSetIdx(0);
    setCurrentEmomRoundIdx(0);
    setRestRemaining(0);
    setIsResting(false);'''
text = re.sub(pattern, repl, text)

# fix handlePrevExercise  
pattern2 = r'const handlePrevExercise = \(\) => \{\s*setCurrentSetIdx\(0\);\s*setRestRemaining\(0\);\s*setIsResting\(false\);'
repl2 = '''const handlePrevExercise = () => {
    setCurrentSetIdx(0);
    setCurrentEmomRoundIdx(0);
    setRestRemaining(0);
    setIsResting(false);'''
text = re.sub(pattern2, repl2, text)

with open('src/pages/ActiveWorkoutPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
