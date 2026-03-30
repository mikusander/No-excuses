import re

with open('src/pages/NewTrainPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove addSuperset definition
content = re.sub(r'const addSuperset = \(\) => \{[\s\S]*?\]\);[\s\n]*\};', '', content)

# 2. Add convertToSuperset definition
convert_fn = '''  const convertToSuperset = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        return {
          ...ex,
          type: 'superset',
          subExercises: [
            { name: ex.name, type: ex.type as 'reps' | 'isometry', reps: ex.reps, duration_seconds: ex.duration_seconds },
            { name: '', type: 'reps', reps: 10, duration_seconds: 0 }
          ]
        };
      }
      return ex;
    }));
  };

  const addEmom'''
content = content.replace('  const addEmom', convert_fn)

# 3. Add button in the UI
button_insertion = '''                    </div>
                  </div>
                </div>
                
                {ex.type !== 'superset' && ex.type !== 'emom' && (
                  <button
                    onClick={() => convertToSuperset(ex.id)}
                    className="w-full mt-2 py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                  >
                    <Plus size={14} className="mr-1" /> ADD EXERCISE (CREATE SUPERSET)
                  </button>
                )}'''

# Find the end of the SEC input block
pattern_sec = r'<span className="text-\[8px\] text-brand-grey/60 uppercase absolute top-1 left-1\.5 font-bold tracking-wider pointer-events-none">SEC</span>\s*</div>\s*</div>\s*</div>\s*</div>'
content = re.sub(pattern_sec, r'<span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">SEC</span>\n                      </div>\n                    </div>\n                  </div>\n                </div>\n\n                {ex.type !== \'superset\' && ex.type !== \'emom\' && (\n                  <button\n                    onClick={() => convertToSuperset(ex.id)}\n                    className="w-full mt-2 py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"\n                  >\n                    <Plus size={14} className="mr-1" /> AGGIUNGI ESERCIZIO E CREA SUPERSET\n                  </button>\n                )}', content)

# 4. Modify the bottom buttons
button_bottom_pattern = r'<div className="flex space-x-3">\s*<button\s*onClick=\{addSuperset\}[\s\S]*?</button>\s*<button\s*onClick=\{addExercise\}[\s\S]*?</button>\s*</div>\s*<button\s*onClick=\{addEmom\}[\s\S]*?</button>'

new_buttons = '''<div className="flex space-x-3">
              <button
                onClick={addExercise}
                className="flex-1 text-brand-orange hover:text-brand-lightOrange flex items-center justify-center text-sm font-bold bg-brand-orange/10 hover:bg-brand-orange/20 px-4 py-3 rounded-xl transition-colors border border-brand-orange/20 border-dashed"
              >
                <Plus size={20} className="mr-1" />
                EXERCISE
              </button>
              <button
                onClick={addEmom}
                className="flex-1 text-blue-400 hover:text-blue-300 flex items-center justify-center text-sm font-bold bg-blue-500/10 hover:bg-blue-500/20 px-4 py-3 rounded-xl transition-colors border border-blue-500/20 border-dashed"
              >
                <Plus size={20} className="mr-1" />
                EMOM
              </button>
            </div>'''
content = re.sub(button_bottom_pattern, new_buttons, content)

with open('src/pages/NewTrainPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
