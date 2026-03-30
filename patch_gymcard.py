import re

with open('c:/Users/MICHELANGELO/No-excuses/src/pages/GymCardPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

parse_old = """            if (ex.type === 'superset') {
              try {
                subExercises = JSON.parse(ex.name);
                parsedName = 'Superset Circuit';
              } catch(e) {}
            }"""

parse_new = """            if (ex.type === 'superset') {
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

render_old = """                    {ex.type === 'superset' ? ("""
render_new = """                    {ex.type === 'superset' || ex.type === 'emom' ? ("""
text = text.replace(render_old, render_new)

hide_reps = """                        {ex.type !== 'superset' && (
                          <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                            <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Reps/Sec</span>
                            <span className="text-sm text-white">{ex.type === 'reps' ? ex.reps : ex.duration_seconds}</span>
                          </div>
                        )}"""

hide_reps_new = """                        {ex.type !== 'superset' && ex.type !== 'emom' && (
                          <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                            <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Reps/Sec</span>
                            <span className="text-sm text-white">{ex.type === 'reps' ? ex.reps : ex.duration_seconds}</span>
                          </div>
                        )}"""
text = text.replace(hide_reps, hide_reps_new)

with open('c:/Users/MICHELANGELO/No-excuses/src/pages/GymCardPage.tsx', 'w', encoding='utf-8') as f:
    f.write(text)

print("GymCard patched")