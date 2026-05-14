#!/usr/bin/env python3
"""Verifica soglie su un singolo test CSV.

Assume le prime `target_tp` transizioni come GOOD e il resto come BAD.

Usage:
  python scripts/verify_single_test_thresholds.py --base "dati di debug" --test "2°" --target 10 --shoulder 0.0243 --wrist 0.0193
"""
from pathlib import Path
import argparse
import pandas as pd
import numpy as np


def frames_from_csv(fp: Path):
    df = pd.read_csv(fp)
    frames = df.groupby('frame_index').apply(lambda g: pd.Series({
        'elapsed_ms': g['elapsed_ms'].iloc[0],
        'left_shoulder': g.loc[g['landmark_index'] == 11, 'y'].mean() if (g['landmark_index'] == 11).any() else np.nan,
        'right_shoulder': g.loc[g['landmark_index'] == 12, 'y'].mean() if (g['landmark_index'] == 12).any() else np.nan,
        'left_wrist': g.loc[g['landmark_index'] == 15, 'y'].mean() if (g['landmark_index'] == 15).any() else np.nan,
        'right_wrist': g.loc[g['landmark_index'] == 16, 'y'].mean() if (g['landmark_index'] == 16).any() else np.nan,
    }))
    frames = frames.sort_values('elapsed_ms').reset_index(drop=True)
    frames['shoulder_y'] = frames[['left_shoulder','right_shoulder']].mean(axis=1)
    frames['wrist_y'] = frames[['left_wrist','right_wrist']].mean(axis=1)
    frames['shoulder_to_bar'] = frames['shoulder_y'] - frames['wrist_y']
    return frames


def detect_sinusoidal_start(series, min_peaks=2, amp_thresh=0.01):
    y = series.values
    n = len(y)
    if n < 5:
        return None
    extrema = []
    for i in range(1, n-1):
        if np.isnan(y[i-1]) or np.isnan(y[i]) or np.isnan(y[i+1]):
            continue
        if y[i] > y[i-1] and y[i] > y[i+1]:
            extrema.append((i, y[i]))
        elif y[i] < y[i-1] and y[i] < y[i+1]:
            extrema.append((i, y[i]))
    if len(extrema) < min_peaks:
        return None
    for start_idx in range(0, n - min_peaks):
        window_ext = [e for e in extrema if e[0] >= start_idx and e[0] < start_idx + min_peaks*3]
        if len(window_ext) >= min_peaks:
            vals = [v for (_, v) in window_ext]
            if (max(vals) - min(vals)) >= amp_thresh:
                return start_idx
    return None


def extract_transitions(frames, down_threshold=0.08, up_threshold=0.02):
    state = 'UNKNOWN'
    down_snapshot = None
    transitions = []
    for i, row in frames.iterrows():
        val = row['shoulder_to_bar']
        if state != 'DOWN' and val > down_threshold:
            state = 'DOWN'
            down_snapshot = {
                'idx': i,
                'elapsed_ms': row['elapsed_ms'],
                'shoulder_y': row['shoulder_y'],
                'left_wrist': row['left_wrist'],
                'right_wrist': row['right_wrist']
            }
        elif state == 'DOWN' and val < up_threshold:
            up_snapshot = {
                'idx': i,
                'elapsed_ms': row['elapsed_ms'],
                'shoulder_y': row['shoulder_y'],
                'left_wrist': row['left_wrist'],
                'right_wrist': row['right_wrist']
            }
            if down_snapshot is not None:
                shoulder_move = abs(up_snapshot['shoulder_y'] - down_snapshot['shoulder_y'])
                left_move = np.nan
                right_move = np.nan
                if not np.isnan(down_snapshot['left_wrist']) and not np.isnan(up_snapshot['left_wrist']):
                    left_move = abs(up_snapshot['left_wrist'] - down_snapshot['left_wrist'])
                if not np.isnan(down_snapshot['right_wrist']) and not np.isnan(up_snapshot['right_wrist']):
                    right_move = abs(up_snapshot['right_wrist'] - down_snapshot['right_wrist'])
                wrist_move = np.nanmean([m for m in [left_move,right_move] if not np.isnan(m)])
                transitions.append({'down_ms': down_snapshot['elapsed_ms'], 'up_ms': up_snapshot['elapsed_ms'],
                                    'shoulder_move': shoulder_move, 'wrist_move': wrist_move})
            state = 'UP'
            down_snapshot = None
    return transitions


def evaluate(good, bad, shoulder_th, wrist_th):
    def valid_row(r):
        wm = r['wrist_move']
        wrist_ok = True if np.isnan(wm) else (wm < wrist_th)
        return (r['shoulder_move'] >= shoulder_th) and wrist_ok

    tp = int(good.apply(valid_row, axis=1).sum())
    fp = int(bad.apply(valid_row, axis=1).sum())
    return tp, fp


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='dati di debug')
    parser.add_argument('--test', default='2°')
    parser.add_argument('--target', type=int, default=10)
    parser.add_argument('--shoulder', type=float, required=True)
    parser.add_argument('--wrist', type=float, required=True)
    args = parser.parse_args()

    base = Path(args.base)
    test_fp = base / f"{args.test} test.csv"
    if not test_fp.exists():
        raise FileNotFoundError(f"Missing {test_fp}")

    frames = frames_from_csv(test_fp)
    start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
    if start_idx is not None:
        frames = frames.iloc[start_idx:].reset_index(drop=True)
    trans = extract_transitions(frames)
    if not trans:
        print('No transitions found')
        return

    df = pd.DataFrame(trans).sort_values('down_ms').reset_index(drop=True)
    good = df.iloc[:args.target]
    bad = df.iloc[args.target:]
    tp, fp = evaluate(good, bad, args.shoulder, args.wrist)

    print(f'Thresholds used: shoulder={args.shoulder} wrist={args.wrist}')
    print(f'GOOD transitions: {len(good)}, TP: {tp}, TPR: {tp/len(good) if len(good) else 0:.2f}')
    print(f'BAD transitions: {len(bad)}, FP: {fp}, FPR: {fp/len(bad) if len(bad) else 0:.2f}')


if __name__ == '__main__':
    main()
