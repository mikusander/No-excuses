import pandas as pd
import matplotlib.pyplot as plt

csv_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\1° test.csv"
df = pd.read_csv(csv_path)
frames = sorted([{'ms': e, 'lm': {r['landmark_index']: r for _, r in g.iterrows()}} for e, g in df.groupby('elapsed_ms')], key=lambda x: x['ms'])

times = []
sy_vals = []

for f in frames:
    lm = f['lm']
    if not all(k in lm for k in [11,12]): continue
    sy = (lm[11]['y'] + lm[12]['y'])/2
    times.append(f['ms']/1000.0)
    sy_vals.append(sy)

# Trova picchi manuali
count = 0
stage = 'UP' # UP means arms extended, so sy is high (~0.76)
UP_TH = 0.65
DOWN_TH = 0.50

rep_markers = []
valid_segments = []
last_up = None

for t, sy in zip(times, sy_vals):
    if stage == 'UP':
        if sy < DOWN_TH:
            stage = 'DOWN'
            last_up = t
    elif stage == 'DOWN':
        if sy > UP_TH:
            stage = 'UP'
            count += 1
            rep_markers.append(t)
            if last_up: valid_segments.append((last_up, t))

print(f"COUNT: {count}")

plt.figure(figsize=(14,6))
plt.plot(times, sy_vals, label='Shoulder Y')
plt.axhline(UP_TH, color='green', linestyle='--', label=f'UP (> {UP_TH})')
plt.axhline(DOWN_TH, color='red', linestyle='--', label=f'DOWN (< {DOWN_TH})')

for i, (start_t, end_t) in enumerate(valid_segments):
    plt.axvspan(start_t, end_t, color='orange', alpha=0.3)

for mk in rep_markers:
    idx = times.index(mk)
    plt.plot(mk, sy_vals[idx], 'ro')

plt.gca().invert_yaxis()
plt.title(f'Test Shoulder Y: {count} reps')
plt.legend()
plt.savefig(r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\test_shoulder.png")
print("Saved to test_shoulder.png")
