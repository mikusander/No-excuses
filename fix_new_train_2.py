import re

with open('src/pages/NewTrainPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Fix mapping in saveWorkout
pattern_save = r'name: \(ex\.type === \'superset\' \|\| ex\.type === \'emom\'\) \? JSON\.stringify\(ex\.subExercises\) : ex\.name,\s*sets: ex\.sets,\s*reps: ex\.type === \'reps\' \? ex\.reps : 0,\s*duration_seconds: \(ex\.type === \'isometry\' \|\| ex\.type === \'emom\'\) \? ex\.duration_seconds : 0,'

repl_save = '''name: ex.type === 'superset' ? JSON.stringify(ex.subExercises) : (ex.type === 'emom' ? JSON.stringify({ subExercises: ex.subExercises, emom_rounds: ex.emom_rounds || 1, emom_round_duration: ex.emom_round_duration || 60 }) : ex.name),
        sets: ex.sets,
        reps: ex.type === 'reps' ? ex.reps : 0,
        duration_seconds: ex.type === 'isometry' ? ex.duration_seconds : 0,'''

text = re.sub(pattern_save, repl_save, text)

# Fix inputs for Rounds/Duration in EMOM (they are currently mapped to sets and duration_seconds)
pattern_emom_inputs = r'<label className=\"text-xs text-brand-grey mb-1\">Total Rounds</label>\s*<input\s*type=\"number\"\s*min=\"1\"\s*value=\{ex\.sets\}\s*onChange=\{\(e\) => updateExercise\(ex\.id, \'sets\', parseInt\(e\.target\.value\) \|\| 1\)\}\s*className=\"bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none\"\s*/>\s*</div>\s*<div className=\"flex flex-col\">\s*<label className=\"text-xs text-brand-grey mb-1\">Round Time \(sec\)</label>\s*<input\s*type=\"number\"\s*min=\"0\"\s*value=\{ex\.duration_seconds\}\s*onChange=\{\(e\) => updateExercise\(ex\.id, \'duration_seconds\', parseInt\(e\.target\.value\) \|\| 0\)\}\s*className=\"bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none\"\s*/>'

repl_emom_inputs = '''<label className="text-xs text-brand-grey mb-1">Total Rounds</label>
                        <input
                          type="number"
                          min="1"
                          value={ex.emom_rounds || 1}
                          onChange={(e) => updateExercise(ex.id, 'emom_rounds', parseInt(e.target.value) || 1)}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Round Time (sec)</label>
                        <input
                          type="number"
                          min="0"
                          value={ex.emom_round_duration || 60}
                          onChange={(e) => updateExercise(ex.id, 'emom_round_duration', parseInt(e.target.value) || 0)}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />'''

text = re.sub(pattern_emom_inputs, repl_emom_inputs, text)

# Show generic for EMOM
pattern_hide = r'\{\/\* Dati Generici \(Serie e Recupero\) \*\/}\s*\{ex\.type !== \'emom\' && \('
repl_hide = r'{/* Dati Generici (Serie e Recupero) */}\n                {'

text = re.sub(pattern_hide, repl_hide, text)

# hide reps/time in generic block for EMOM
pattern_repstime = r'\{ex\.type !== \'superset\' && \(\s*<div className=\"flex flex-col\">\s*<label className=\"text-\[10px\] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1 text-center\">\s*\{ex\.type === \'reps\' \? \'Reps\' : \'Time \(sec\)\'\}'

repl_repstime = '''{ex.type !== 'superset' && ex.type !== 'emom' && (
                    <div className="flex flex-col">
                      <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1 text-center">
                        {ex.type === 'reps' ? 'Reps' : 'Time (sec)'}'''
                        
text = re.sub(pattern_repstime, repl_repstime, text)

# remove )} added earlier
pattern_closing = r'</div>\s*</div>\s*</div>\s*</div>\s*\)}\s*</div>\s*\)\)\s*\)}'
repl_closing = r'</div>\n                    </div>\n                  </div>\n                </div>\n              </div>\n            ))\n          )}'

text = re.sub(pattern_closing, repl_closing, text)

with open('src/pages/NewTrainPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
