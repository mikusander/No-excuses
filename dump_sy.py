import pandas as pd
df = pd.read_csv(r'c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\1° test.csv')
frames = sorted([{'ms': e, 'lm': {r['landmark_index']: r for _, r in g.iterrows()}} for e, g in df.groupby('elapsed_ms')], key=lambda x: x['ms'])
for f in frames:
    t = f['ms']/1000.0
    if 21 < t < 24:
        lm = f['lm']
        if 11 in lm and 12 in lm:
            sy = (lm[11]['y'] + lm[12]['y'])/2
            print(f"{t:.1f}s: {sy:.3f}")
