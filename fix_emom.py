import re

with open('src/pages/NewTrainPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

pattern1 = r'<p className="text-xs font-bold text-blue-400 uppercase tracking-wider text-center mb-2 flex flex-col items-center justify-center">\s*?? EMOM Circuit\s*</p>'
repl1 = '''<p className="text-xs font-bold text-blue-400 uppercase tracking-wider text-center mb-2 flex flex-col items-center justify-center">
                      ?? EMOM Circuit
                    </p>
                    <div className="grid grid-cols-2 gap-2 mb-4 mt-3">
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Total Rounds</label>
                        <input
                          type="number"
                          min="1"
                          value={ex.sets}
                          onChange={(e) => updateExercise(ex.id, 'sets', parseInt(e.target.value) || 1)}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Round Time (sec)</label>
                        <input
                          type="number"
                          min="0"
                          value={ex.duration_seconds}
                          onChange={(e) => updateExercise(ex.id, 'duration_seconds', parseInt(e.target.value) || 0)}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
                      </div>
                    </div>'''

text = re.sub(pattern1, repl1, text)

# Dati Generici regex
pattern2 = r'\{/\* Dati Generici \(Serie e Recupero\) \*/\}\s*<div className=\{\grid \$\{ex\.type === \'superset\' \? \'grid-cols-2\' : \'grid-cols-3\'\} gap-3\\}>'
repl2 = '''{/* Dati Generici (Serie e Recupero) */}
                  {ex.type !== 'emom' && (
                  <div className={grid  gap-3}>'''

text = re.sub(pattern2, repl2, text)

# Now we need to close the parenthesis after the Dati Generici div ends.
# It ends right before <div className="mt-4 flex items-center justify-between">! Let's check!
