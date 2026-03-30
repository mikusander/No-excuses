import re

with open('c:/Users/MICHELANGELO/No-excuses/src/pages/GymCardPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix the type issue in GymCardPage
gym_old = """(sub.type === 'reps' ? sub.reps + ' reps' : sub.duration_seconds + ' s')"""
gym_new = """(sub.type === 'reps' ? sub.reps + ' reps' : sub.type === 'isometry' ? sub.duration_seconds + ' s' : '')"""
text = text.replace(gym_old, gym_new)

with open('c:/Users/MICHELANGELO/No-excuses/src/pages/GymCardPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)


with open('c:/Users/MICHELANGELO/No-excuses/src/pages/NewTrainPage.tsx', 'r', encoding='utf-8') as f:
    train_text = f.read()

buttons_old = """          <div className="flex space-x-3 pt-2">
            <button
              onClick={addSuperset}
              className="flex-1 text-white hover:text-brand-lightOrange flex items-center justify-center text-sm font-bold bg-white/10 hover:bg-white/20 px-4 py-3 rounded-xl transition-colors border border-white/5 border-dashed"
            >
              <Plus size={16} className="mr-1.5 opacity-70" /> Superset
            </button>
            <button
              onClick={addExercise}
              className="flex-[1.5] bg-brand-orange hover:bg-brand-lightOrange text-black flex items-center justify-center font-black py-3 rounded-xl transition-colors shadow-lg"
            >
              <Plus size={18} className="mr-1.5 opacity-70" /> Add Single
            </button>
          </div>"""

buttons_new = """          <div className="flex flex-col space-y-3 pt-2">
            <div className="flex space-x-3">
              <button
                onClick={addSuperset}
                className="flex-1 text-white hover:text-brand-lightOrange flex items-center justify-center text-sm font-bold bg-white/10 hover:bg-white/20 px-4 py-3 rounded-xl transition-colors border border-white/5 border-dashed"
              >
                <Plus size={16} className="mr-1.5 opacity-70" /> Superset
              </button>
              <button
                onClick={addExercise}
                className="flex-[1.5] bg-brand-orange hover:bg-brand-lightOrange text-black flex items-center justify-center font-black py-3 rounded-xl transition-colors shadow-lg"
              >
                <Plus size={18} className="mr-1.5 opacity-70" /> Add Single
              </button>
            </div>
            <button
              onClick={addEmom}
              className="w-full py-3 border border-dashed border-blue-500/30 text-blue-400 font-bold rounded-xl hover:bg-blue-500/10 transition-colors flex justify-center items-center"
            >
              <Plus size={16} className="mr-1.5" /> Add EMOM
            </button>
          </div>"""

train_text = train_text.replace(buttons_old, buttons_new)

with open('c:/Users/MICHELANGELO/No-excuses/src/pages/NewTrainPage.tsx', 'w', encoding='utf-8') as f:
    f.write(train_text)

print('Patched!')