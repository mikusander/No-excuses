import pandas as pd
import matplotlib.pyplot as plt

# Sostituisci questo percorso con il file CSV che vuoi testare
csv_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\1° test.csv"

try:
    df = pd.read_csv(csv_path)
    frames = sorted([{'ms': e, 'lm': {r['landmark_index']: r for _, r in g.iterrows()}} for e, g in df.groupby('elapsed_ms')], key=lambda x: x['ms'])

    times = []
    sy_vals = []

    for f in frames:
        lm = f['lm']
        if 11 not in lm or 12 not in lm or 15 not in lm or 16 not in lm: continue
        sy = (lm[11]['y'] + lm[12]['y'])/2
        times.append(f['ms']/1000.0)
        sy_vals.append(sy)

    state = 'UP'
    count = 0
    min_y = None
    max_y = None
    snap_wl = None
    snap_wr = None
    
    EXCURSION_THRESHOLD = 0.10 
    WRIST_MOVE_THRESHOLD = 0.05

    rep_markers = []
    valid_segments = []
    invalid_segments = []
    last_up = None

    for t, f in zip(times, frames):
        lm = f['lm']
        sy = (lm[11]['y'] + lm[12]['y'])/2
        lwy = lm[15]['y']
        rwy = lm[16]['y']

        if state == 'UP':
            # Cerchiamo il picco minimo (più in alto nello schermo, braccia distese)
            if min_y is None or sy < min_y:
                min_y = sy
                
            # Discesa iniziata (Y aumenta)
            if sy - min_y > EXCURSION_THRESHOLD:
                state = 'DOWN'
                max_y = sy
                snap_wl = lwy
                snap_wr = rwy
                last_up = t
                
        elif state == 'DOWN':
            # Cerchiamo il picco massimo (più in basso nello schermo, petto a terra)
            if max_y is None or sy > max_y:
                max_y = sy
                # PRENDIAMO LO SNAPSHOT POLSI AL PUNTO PIÙ BASSO!
                snap_wl = lwy
                snap_wr = rwy
                
            # Risalita terminata (Y diminuisce)
            if max_y - sy > EXCURSION_THRESHOLD:
                # Validazione anti-fake polsi
                left_wrist_moved = abs(lwy - snap_wl) >= WRIST_MOVE_THRESHOLD
                right_wrist_moved = abs(rwy - snap_wr) >= WRIST_MOVE_THRESHOLD
                wrists_stable = not (left_wrist_moved or right_wrist_moved)
                
                if wrists_stable:
                    count += 1
                    rep_markers.append(t)
                    if last_up is not None:
                        valid_segments.append((last_up, t))
                    print(f"Rep OK a {t:.1f}s")
                else:
                    if last_up is not None:
                        invalid_segments.append((last_up, t))
                    print(f"FAKE REP ignorata a {t:.1f}s. Polsi mossi (L: {abs(lwy - snap_wl):.3f}, R: {abs(rwy - snap_wr):.3f})")

                # Reset per il prossimo ciclo
                state = 'UP'
                min_y = sy

    print(f"\n---> CONTEGGIO FINALE: {count} ripetizioni valide <---")

    # Plot del grafico
    plt.figure(figsize=(14, 6))
    plt.plot(times, sy_vals, label='Altezza Spalle (Shoulder Y)', color='blue')
    for i, (start_t, end_t) in enumerate(valid_segments):
        plt.axvspan(start_t, end_t, color='lightgray', alpha=0.5, label='Fase Push-Up Valida' if i == 0 else "")
    for i, (start_t, end_t) in enumerate(invalid_segments):
        plt.axvspan(start_t, end_t, color='black', alpha=0.3, label='Fase Push-Up Falsa/Scartata' if i == 0 else "")
    for i, mk in enumerate(rep_markers):
        idx = times.index(mk)
        plt.plot(mk, sy_vals[idx], 'ro', markersize=10, label='Conteggio Ripetizione' if i == 0 else "")
    plt.gca().invert_yaxis()
    plt.title(f'Test Modello Push-Up Corretto: {count} ripetizioni valide contate')
    plt.xlabel('Tempo (secondi)')
    plt.ylabel('Posizione Spalle sull\'asse Y')
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.grid(True, alpha=0.5)
    plt.tight_layout()
    output_path = r"c:\Users\MICHELANGELO\No-excuses\dati di debug\dati di debug push-up\grafico_test_pushup.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight')

except Exception as e:
    import traceback
    traceback.print_exc()

