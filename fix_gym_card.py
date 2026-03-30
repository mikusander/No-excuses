import re

with open('src/pages/GymCardPage.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# in GymCardPage:

# Fix fetch mapping
pattern_fetch = r'\} else if \(ex\.type === \'emom\'\) \{\s*try \{\s*const parsed = JSON\.parse\(ex\.name\);\s*if \(Array\.isArray\(parsed\)\) \{\s*subExercises = parsed;\s*\} else if \(parsed && parsed\.subExercises\) \{\s*subExercises = parsed\.subExercises;\s*ex\.sets = parsed\.emom_rounds \|\| ex\.sets;\s*ex\.duration_seconds = parsed\.emom_round_duration \|\| ex\.duration_seconds;\s*\}'

repl_fetch = '''} else if (ex.type === 'emom') {
            try {
              const parsed = JSON.parse(ex.name);
              if (Array.isArray(parsed)) {
                subExercises = parsed;
              } else if (parsed && parsed.subExercises) {
                subExercises = parsed.subExercises;
                ex.emom_rounds = parsed.emom_rounds;
                ex.emom_round_duration = parsed.emom_round_duration;
              }'''
              
text = re.sub(pattern_fetch, repl_fetch, text)

# Fix sets/rounds label
pattern_labels = r'\{ex\.type === \'superset\' \? \'Round\' : \(ex\.type === \'emom\' \? \'Rounds\' : \'Sets\'\)\}'
repl_labels = r"{ex.type === 'superset' ? 'Round' : 'Sets'}"

text = re.sub(pattern_labels, repl_labels, text)

# We want to display the specific EMOM fields!
# Since I need to show both sets and remom_rounds, maybe I can just show the normal sets. But where do I show EMOM rounds?
# Wait! Since I want to add ounds and duration block for EMOM...
