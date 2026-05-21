import pandas as pd
import matplotlib.pyplot as plt

csv_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\1° test.csv"

try:
    df = pd.read_csv(csv_path)

    frames = []
    for elapsed_ms, group in df.groupby('elapsed_ms'):
        landmarks = {}
        for _, row in group.iterrows():
            idx = row['landmark_index']
            landmarks[idx] = {'y': row['y']}
        frames.append({'elapsed_ms': elapsed_ms, 'landmarks': landmarks})

    frames = sorted(frames, key=lambda f: f['elapsed_ms'])

    times = []
    shoulder_ys = []
    wrist_ys = []
    arm_exts = []

    for frame in frames:
        t = frame['elapsed_ms'] / 1000.0
        lm = frame['landmarks']
        if not all(k in lm for k in [11, 12, 13, 14, 15, 16]): continue
        
        sy = (lm[11]['y'] + lm[12]['y']) / 2.0
        ey = (lm[13]['y'] + lm[14]['y']) / 2.0
        wy = (lm[15]['y'] + lm[16]['y']) / 2.0
        
        times.append(t)
        shoulder_ys.append(sy)
        wrist_ys.append(wy)
        arm_exts.append(ey - sy)

    plt.figure(figsize=(14, 6))
    plt.plot(times, shoulder_ys, label='Shoulder Y (Spalle)', color='blue')
    plt.plot(times, wrist_ys, label='Wrist Y (Polsi)', color='orange')
    plt.plot(times, arm_exts, label='Elbow Y - Shoulder Y (Estensione vecchia)', color='green', alpha=0.3)
    plt.gca().invert_yaxis()
    plt.legend()
    plt.title('Shoulder Y vs Wrist Y vs Vecchia estensione')
    
    out_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\shoulder_wrist_y.png"
    plt.savefig(out_path)
    print("SUCCESS")
except Exception as e:
    print(e)
