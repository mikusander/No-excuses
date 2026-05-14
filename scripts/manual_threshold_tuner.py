#!/usr/bin/env python3
"""Interactive manual tuner for shoulder/wrist thresholds.

Single-file mode (no labels):
    python scripts/manual_threshold_tuner.py --base "dati di debug" --test "1°"

Optional one-shot evaluation:
    python scripts/manual_threshold_tuner.py --base "dati di debug" --test "1°" --eval 0.0243 0.0193
"""
from __future__ import annotations

from pathlib import Path
import argparse
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt


def frames_from_csv(fp: Path) -> pd.DataFrame:
    df = pd.read_csv(fp)
    frames = df.groupby('frame_index').apply(lambda g: pd.Series({
        'elapsed_ms': g['elapsed_ms'].iloc[0],
        'left_shoulder': g.loc[g['landmark_index'] == 11, 'y'].mean() if (g['landmark_index'] == 11).any() else np.nan,
        'right_shoulder': g.loc[g['landmark_index'] == 12, 'y'].mean() if (g['landmark_index'] == 12).any() else np.nan,
        'left_wrist': g.loc[g['landmark_index'] == 15, 'y'].mean() if (g['landmark_index'] == 15).any() else np.nan,
        'right_wrist': g.loc[g['landmark_index'] == 16, 'y'].mean() if (g['landmark_index'] == 16).any() else np.nan,
    }), include_groups=False)
    frames = frames.sort_values('elapsed_ms').reset_index(drop=True)
    frames['shoulder_y'] = frames[['left_shoulder', 'right_shoulder']].mean(axis=1)
    frames['wrist_y'] = frames[['left_wrist', 'right_wrist']].mean(axis=1)
    frames['shoulder_to_bar'] = frames['shoulder_y'] - frames['wrist_y']
    return frames


def plot_transitions(frames: pd.DataFrame, test_name: str, rows: pd.DataFrame, out_path: Path) -> None:
    if frames.empty:
        return
    fig, ax = plt.subplots(figsize=(10, 5), dpi=200)
    ax.plot(frames['elapsed_ms'], frames['left_shoulder'], label='left_shoulder', linewidth=1.0)
    ax.plot(frames['elapsed_ms'], frames['right_shoulder'], label='right_shoulder', linewidth=1.0)
    ax.plot(frames['elapsed_ms'], frames['left_wrist'], label='left_wrist', linewidth=1.0)
    ax.plot(frames['elapsed_ms'], frames['right_wrist'], label='right_wrist', linewidth=1.0)

    if not rows.empty:
        for _, r in rows.iterrows():
            color = '#d9d9d9' if r['is_valid'] else '#4d4d4d'
            ax.axvspan(r['down_ms'], r['up_ms'], color=color, alpha=0.18)

    ax.set_title(f"{test_name} — shoulders & wrists with transitions")
    ax.set_xlabel('elapsed_ms')
    ax.set_ylabel('y')
    ax.legend(loc='best', fontsize=8)
    ax.grid(True, which='major', linestyle='-', linewidth=0.6, alpha=0.6)
    ax.grid(True, which='minor', linestyle=':', linewidth=0.4, alpha=0.4)
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path)
    plt.close(fig)


def detect_sinusoidal_start(series: pd.Series, min_peaks: int = 2, amp_thresh: float = 0.01) -> int | None:
    y = series.values
    n = len(y)
    if n < 5:
        return None
    extrema = []
    for i in range(1, n - 1):
        if np.isnan(y[i - 1]) or np.isnan(y[i]) or np.isnan(y[i + 1]):
            continue
        if y[i] > y[i - 1] and y[i] > y[i + 1]:
            extrema.append((i, y[i]))
        elif y[i] < y[i - 1] and y[i] < y[i + 1]:
            extrema.append((i, y[i]))
    if len(extrema) < min_peaks:
        return None
    for start_idx in range(0, n - min_peaks):
        window_ext = [e for e in extrema if e[0] >= start_idx and e[0] < start_idx + min_peaks * 3]
        if len(window_ext) >= min_peaks:
            vals = [v for (_, v) in window_ext]
            if (max(vals) - min(vals)) >= amp_thresh:
                return start_idx
    return None


def extract_transitions(frames: pd.DataFrame, down_threshold: float, up_threshold: float) -> list[dict]:
    state = 'UNKNOWN'
    down_snapshot = None
    transitions = []
    
    for i, row in frames.iterrows():
        val = row['shoulder_to_bar']
        
        # ---------------------------------------------------------
        # FASE DI DOWN
        # ---------------------------------------------------------
        if val > down_threshold:
            if state != 'DOWN':
                state = 'DOWN'
                down_snapshot = {
                    'idx': i,
                    'start_ms': row['elapsed_ms'], # Manteniamo l'inizio della banda per il grafico
                    'elapsed_ms': row['elapsed_ms'],
                    'shoulder_y': row['shoulder_y'],
                    'left_wrist': row['left_wrist'],
                    'right_wrist': row['right_wrist'],
                }
            elif down_snapshot is not None:
                # 1. Spalle: Aggiorniamo per trovare il punto più basso assoluto (Y maggiore)
                if row['shoulder_y'] > down_snapshot['shoulder_y']:
                    down_snapshot['shoulder_y'] = row['shoulder_y']
                
                # 2. Polsi: Aggiornamento Continuo (La Soluzione al Rumore/Assestamento)
                # Finché siamo in questa fase, sovrascriviamo incondizionatamente.
                down_snapshot['left_wrist'] = row['left_wrist']
                down_snapshot['right_wrist'] = row['right_wrist']

        # ---------------------------------------------------------
        # FASE DI UP
        # ---------------------------------------------------------
        elif state == 'DOWN' and val < up_threshold:
            up_snapshot = {
                'idx': i,
                'elapsed_ms': row['elapsed_ms'],
                'shoulder_y': row['shoulder_y'],
                'left_wrist': row['left_wrist'],
                'right_wrist': row['right_wrist'],
            }
            
            if down_snapshot is not None:
                shoulder_move = abs(up_snapshot['shoulder_y'] - down_snapshot['shoulder_y'])
                left_move = np.nan
                right_move = np.nan
                
                if not np.isnan(down_snapshot['left_wrist']) and not np.isnan(up_snapshot['left_wrist']):
                    left_move = abs(up_snapshot['left_wrist'] - down_snapshot['left_wrist'])
                if not np.isnan(down_snapshot['right_wrist']) and not np.isnan(up_snapshot['right_wrist']):
                    right_move = abs(up_snapshot['right_wrist'] - down_snapshot['right_wrist'])
                    
                wrist_move = np.nanmean([m for m in [left_move, right_move] if not np.isnan(m)])
                
                transitions.append({
                    'down_ms': down_snapshot['start_ms'], # Usiamo l'inizio reale per colorare la banda
                    'up_ms': up_snapshot['elapsed_ms'],
                    'shoulder_move': shoulder_move,
                    'wrist_move': wrist_move,
                })
                
            state = 'UP'
            down_snapshot = None
            
    return transitions


def evaluate(df: pd.DataFrame, shoulder_th: float, wrist_th: float) -> tuple[int, pd.DataFrame]:
    def valid_row(r):
        wm = r['wrist_move']
        wrist_ok = True if np.isnan(wm) else (wm < wrist_th)
        return (r['shoulder_move'] >= shoulder_th) and wrist_ok

    if df.empty:
        return 0, df
    mask = df.apply(valid_row, axis=1)
    out = df.copy()
    out['is_valid'] = mask
    return int(mask.sum()), out


def parse_list(value: str) -> list[str]:
    return [v.strip() for v in value.split(',') if v.strip()]


def load_transitions_for_test(base: Path, test_name: str, down_th: float, up_th: float) -> pd.DataFrame:
    test_fp = base / f"{test_name} test.csv"
    if not test_fp.exists():
        return pd.DataFrame([])
    frames = frames_from_csv(test_fp)
    start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
    if start_idx is not None:
        frames = frames.iloc[start_idx:].reset_index(drop=True)
    trans = extract_transitions(frames, down_th, up_th)
    if not trans:
        return pd.DataFrame([])
    return pd.DataFrame(trans).sort_values('down_ms').reset_index(drop=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='dati di debug')
    parser.add_argument('--test', required=True, help='Test name, e.g. "1°" for "1° test.csv"')
    parser.add_argument('--down-threshold', type=float, default=0.08)
    parser.add_argument('--up-threshold', type=float, default=0.02)
    parser.add_argument('--eval', nargs=2, type=float, metavar=('SHOULDER', 'WRIST'))
    parser.add_argument('--show-intervals', action='store_true', help='Print valid transition intervals')
    parser.add_argument('--plot-intervals', action='store_true', help='Save plot with transition intervals')
    parser.add_argument('--plot-out', default='dati di debug/output/plots_transitions', help='Output folder for plots')
    args = parser.parse_args()

    base = Path(args.base)
    df = load_transitions_for_test(base, args.test, args.down_threshold, args.up_threshold)
    frames = frames_from_csv(base / f"{args.test} test.csv")
    print(f'Loaded transitions: TOTAL={len(df)}')
    print('Threshold meaning:')
    print('- shoulder: min shoulder movement from DOWN to UP (higher = stricter)')
    print('- wrist: max wrist movement allowed from DOWN to UP (lower = stricter)')
    print('Enter thresholds as "shoulder,wrist" or "q" to quit.')

    if args.eval:
        shoulder_th, wrist_th = args.eval
        valid, rows = evaluate(df, shoulder_th, wrist_th)
        print(f'Thresholds: shoulder={shoulder_th} (min shoulder move), wrist={wrist_th} (max wrist move)')
        print(f'Valid transitions: {valid} / {len(df)}')
        if args.show_intervals and not rows.empty:
            print('Transitions (down_ms -> up_ms | valid | shoulder_move | wrist_move):')
            for _, r in rows.iterrows():
                flag = 'valid' if r['is_valid'] else 'invalid'
                print(
                    f"- {r['down_ms']:.0f} -> {r['up_ms']:.0f} | {flag} | "
                    f"{r['shoulder_move']:.4f} | {r['wrist_move']:.4f}"
                )
        if args.plot_intervals:
            out_path = Path(args.plot_out) / f"{args.test} test_transitions.png"
            plot_transitions(frames, f"{args.test} test", rows, out_path)
            print(f"Saved plot: {out_path}")
        return

    while True:
        raw = input('thresholds> ').strip()
        if raw.lower() in {'q', 'quit', 'exit'}:
            break
        if not raw:
            continue
        if ',' not in raw:
            print('Use format: shoulder,wrist')
            continue
        try:
            shoulder_th, wrist_th = [float(v.strip()) for v in raw.split(',', 1)]
        except ValueError:
            print('Invalid numbers. Example: 0.05,0.02')
            continue
        valid, rows = evaluate(df, shoulder_th, wrist_th)
        print(f'Thresholds: shoulder={shoulder_th} (min shoulder move), wrist={wrist_th} (max wrist move)')
        print(f'Valid transitions: {valid} / {len(df)}')
        if args.show_intervals and not rows.empty:
            print('Transitions (down_ms -> up_ms | valid | shoulder_move | wrist_move):')
            for _, r in rows.iterrows():
                flag = 'valid' if r['is_valid'] else 'invalid'
                print(
                    f"- {r['down_ms']:.0f} -> {r['up_ms']:.0f} | {flag} | "
                    f"{r['shoulder_move']:.4f} | {r['wrist_move']:.4f}"
                )
        if args.plot_intervals:
            out_path = Path(args.plot_out) / f"{args.test} test_transitions.png"
            plot_transitions(frames, f"{args.test} test", rows, out_path)
            print(f"Saved plot: {out_path}")


if __name__ == '__main__':
    main()