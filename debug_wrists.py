import pandas as pd
import matplotlib.pyplot as plt

csv_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\1° test.csv"
df = pd.read_csv(csv_path)

frames = sorted([{'ms': e, 'lm': {r['landmark_index']: r for _, r in g.iterrows()}} for e, g in df.groupby('elapsed_ms')], key=lambda x: x['ms'])

times = []
sy_vals = []
lwy_vals = []
rwy_vals = []

for f in frames:
    lm = f['lm']
    if not all(k in lm for k in [11,12,15,16]): continue
    ls, rs, lw, rw = lm[11], lm[12], lm[15], lm[16]
    sy = (ls['y'] + rs['y'])/2
    
    times.append(f['ms']/1000.0)
    sy_vals.append(sy)
    lwy_vals.append(lw['y'])
    rwy_vals.append(rw['y'])

plt.figure(figsize=(14, 6))
plt.plot(times, sy_vals, label='Shoulder Y', color='blue')
plt.plot(times, lwy_vals, label='Left Wrist Y', color='orange')
plt.plot(times, rwy_vals, label='Right Wrist Y', color='red')
plt.gca().invert_yaxis()
plt.legend()
plt.title('Shoulders vs Wrists Y Movement')
plt.grid(True)
plt.savefig(r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\debug_wrists.png")
print("Plot saved to debug_wrists.png")
