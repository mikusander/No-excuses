import sys, re

with open('c:/Users/MICHELANGELO/No-excuses/src/pages/NewTrainPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. loadWorkout - parsing
old_load = """catch (e) {
              console.error('Error parsing superset JSON:', e);
            }
          }"""
new_load = """catch (e) {
              console.error('Error parsing superset JSON:', e);
            }
          }

          if (ex.type === 'emom') {
            try {
              const parsed = JSON.parse(ex.name);
              if (parsed.subExercises) subExercises = parsed.subExercises;
              ex.emom_rounds = parsed.emom_rounds || 1;
              ex.emom_round_duration = parsed.emom_round_duration || 60;
              parsedName = ''; 
            } catch (e) {
              console.error('Error parsing emom JSON:', e);
            }
          }"""
content = content.replace(old_load, new_load)


# 2. addEmom
old_remove = """const removeExercise = (id: string) => {"""
new_remove = """const addEmom = () => {
    setExercises([
      ...exercises,
      {
        id: crypto.randomUUID(), type: 'emom', name: '', sets: 1, reps: 0, duration_seconds: 0, rest_seconds: 60, emom_rounds: 10, emom_round_duration: 60, subExercises: [
          { name: '', type: 'reps', reps: 10, duration_seconds: 0 }
        ]
      }
    ]);
  };

  const removeExercise = (id: string) => {"""
content = content.replace(old_remove, new_remove)

# 3. Validation
old_val = """} else {
        if (!ex.name.trim()) {"""
new_val = """} else if (ex.type === 'emom') {
        if (!ex.subExercises || ex.subExercises.length === 0) {
          setError('EMOM must contain at least 1 exercise'); return;
        }
        for (const sub of ex.subExercises) {
          if (!sub.name.trim()) { setError('All exercises in an EMOM must have a name'); return; }
        }
      } else {
        if (!ex.name.trim()) {"""
content = content.replace(old_val, new_val)

# 4. JSON Serialization
old_json = """name: ex.type === 'superset' ? JSON.stringify(ex.subExercises) : ex.name,"""
new_json = """name: ex.type === 'superset' ? JSON.stringify(ex.subExercises) : (ex.type === 'emom' ? JSON.stringify({ subExercises: ex.subExercises, emom_rounds: ex.emom_rounds, emom_round_duration: ex.emom_round_duration }) : ex.name),"""
content = content.replace(old_json, new_json)

import re

# 5. Buttons in UI
new_add_buttons = """<div className="flex flex-col space-y-2">
            <div className="flex space-x-2">
              <button
                onClick={addExercise}
                className="flex-1 py-4 border-2 border-dashed border-brand-grey/30 text-brand-grey font-bold rounded-2xl hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
              >
                <Plus size={20} className="mr-2" /> ADD EXERCISE
              </button>
              <button
                onClick={addSuperset}
                className="flex-1 py-4 border-2 border-dashed border-brand-orange/30 text-brand-orange font-bold rounded-2xl hover:bg-brand-orange/10 transition-colors flex justify-center items-center"
              >
                <Plus size={20} className="mr-2" /> ADD SUPERSET
              </button>
            </div>
            <button
              onClick={addEmom}
              className="w-full py-4 border-2 border-dashed border-blue-500/30 text-blue-400 font-bold rounded-2xl hover:bg-blue-500/10 transition-colors flex justify-center items-center"
            >
              <Plus size={20} className="mr-2" /> ADD EMOM
            </button>
          </div>"""

# Ensure we remove the old <div> className="flex space-x-2"> block
content = re.sub(
    r'<div className=\"flex space-x-2\">\s*<button\s*onClick=\{addExercise\}[\s\S]*?ADD SUPERSET\s*</button>\s*</div>',
    new_add_buttons,
    content
)

# 6. UI Rendering for EMOM inside the `.map((ex, index) =>`
old_ex_render = """{ex.type === 'superset' ? ("""
new_ex_render = """{ex.type === 'emom' ? (
                  <div className="space-y-3 bg-brand-dark/30 p-4 rounded-xl border border-blue-500/20">
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-wider text-center mb-2 flex flex-col items-center justify-center">
                      ⏱️ EMOM Circuit
                    </p>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Total Sets</label>
                        <input
                          type="number"
                          min="1"
                          value={ex.sets}
                          onChange={(e) => updateExercise(ex.id, 'sets', parseInt(e.target.value) || 1)}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Rest Btw Sets (sec)</label>
                        <input
                          type="number"
                          min="0"
                          value={ex.rest_seconds}
                          onChange={(e) => updateExercise(ex.id, 'rest_seconds', parseInt(e.target.value) || 0)}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Total Rounds</label>
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
                        />
                      </div>
                    </div>
                    
                    {ex.subExercises?.map((sub, sIdx) => (
                      <div key={sIdx} className="flex flex-col space-y-2 relative pr-8">
                        <input
                          type="text"
                          placeholder={`Exercise Name ${sIdx + 1}`}
                          value={sub.name}
                          onChange={(e) => updateSubExercise(ex.id, sIdx, 'name', e.target.value)}
                          className="w-full bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-400 outline-none"
                        />
                        <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                          <button
                            onClick={() => updateSubExercise(ex.id, sIdx, 'type', 'reps')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'reps' ? 'bg-blue-400 text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            REPS
                          </button>
                          <button
                            onClick={() => updateSubExercise(ex.id, sIdx, 'type', 'isometry')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'isometry' ? 'bg-blue-400 text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            ISOMETRIC
                          </button>
                        </div>
                        <div>
                          <input
                            type="number"
                            min="1"
                            value={sub.type === 'reps' ? sub.reps : sub.duration_seconds}
                            onChange={(e) => updateSubExercise(ex.id, sIdx, sub.type === 'reps' ? 'reps' : 'duration_seconds', parseInt(e.target.value) || 0)}
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-blue-400 outline-none"
                            placeholder={sub.type === 'reps' ? 'Reps' : 'Time (sec)'}
                          />
                        </div>
                        {ex.subExercises && ex.subExercises.length > 1 && (
                          <button
                            onClick={() => removeSubExercise(ex.id, sIdx)}
                            className="absolute right-0 top-1 text-red-500/50 hover:text-red-500 p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => addSubExercise(ex.id)}
                      className="w-full mt-2 py-2 border border-dashed border-brand-grey/30 text-brand-grey/70 text-xs font-bold rounded-lg hover:border-blue-400/50 hover:text-blue-400 transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> ADD TO EMOM
                    </button>
                  </div>
                ) : ex.type === 'superset' ? ("""
content = content.replace(old_ex_render, new_ex_render)

with open('c:/Users/MICHELANGELO/No-excuses/src/pages/NewTrainPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("success")
