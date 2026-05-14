#!/usr/bin/env python3
"""Ricalcola soglie robusthe dalle cartelle di test.

Usage:
  python scripts/recompute_thresholds_from_tests.py --base "dati di debug" --out "dati di debug/analysis_output"

Tratta i folder '1° test','2° test','3° test' come GOOD e '5° test' come BAD.
"""
from pathlib import Path
import argparse
import glob
import pandas as pd
import numpy as np


def find_files_in_dirs(base: Path, dirs):
    files = []
    for d in dirs:
        p = base / d
        if not p.exists():
            continue
        files += sorted(glob.glob(str(p / "mediapipe-debug-*.csv")))
    return files


def find_test_csv(base: Path, name: str):
    # Expected file name like "1° test.csv"
    fp = base / f"{name} test.csv"
    return fp if fp.exists() else None


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


def detect_sinusoidal_start(series, window_ms=1000, min_peaks=2, amp_thresh=0.01):
    # simple local peak/trough detection: compare neighbors
    y = series.values
    times = series.index.values
    n = len(y)
    if n < 5:
        return None
    # compute local extrema
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
    # sliding window by index: find first window with min_peaks extrema and amplitude > amp_thresh
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
                transitions.append({'down_idx': down_snapshot['idx'], 'up_idx': up_snapshot['idx'],
                                    'down_ms': down_snapshot['elapsed_ms'], 'up_ms': up_snapshot['elapsed_ms'],
                                    'shoulder_move': shoulder_move, 'left_move': left_move, 'right_move': right_move, 'wrist_move': wrist_move})
            state = 'UP'
            down_snapshot = None
    return transitions


def process_files(files):
    all_trans = []
    for f in files:
        frames = frames_from_csv(Path(f))
        # detect sinusoidal start
        start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
        if start_idx is not None:
            frames = frames.iloc[start_idx:].reset_index(drop=True)
        trans = extract_transitions(frames)
        for t in trans:
            t['source'] = f
        all_trans += trans
    if not all_trans:
        return pd.DataFrame([])
    df = pd.DataFrame(all_trans)
    return df.sort_values('down_ms').reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='dati di debug')
    parser.add_argument('--out', default='dati di debug/analysis_output')
    args = parser.parse_args()

    base = Path(args.base)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # Prefer aggregated test CSVs if present, otherwise fall back to folders
    test1 = find_test_csv(base, '1°')
    test2 = find_test_csv(base, '2°')
    test3 = find_test_csv(base, '3°')
    test4 = find_test_csv(base, '4°')
    test5 = find_test_csv(base, '5°')

    if test1 or test2 or test3 or test4 or test5:
        good_parts = []
        bad_parts = []

        for fp in [test1, test2]:
            if fp:
                good_parts.append(process_files([fp]))

        # 3° test: prime 10 esecuzioni corrette, resto falsi positivi
        if test3:
            t3 = process_files([test3])
            if not t3.empty:
                good_parts.append(t3.iloc[:10])
                bad_parts.append(t3.iloc[10:])

        if test4:
            bad_parts.append(process_files([test4]))

        if test5:
            bad_parts.append(process_files([test5]))

        good_df = pd.concat(good_parts, ignore_index=True) if good_parts else pd.DataFrame([])
        bad_df = pd.concat(bad_parts, ignore_index=True) if bad_parts else pd.DataFrame([])
    else:
        good_dirs = ['1° test', '2° test', '4° test']
        bad_dirs = ['5° test']
        good_files = find_files_in_dirs(base, good_dirs)
        bad_files = find_files_in_dirs(base, bad_dirs)
        print(f'Found good files: {len(good_files)}, bad files: {len(bad_files)}')
        good_df = process_files(good_files)
        bad_df = process_files(bad_files)

    good_out = out / 'good_transitions.csv'
    bad_out = out / 'bad_transitions.csv'
    good_df.to_csv(good_out, index=False)
    bad_df.to_csv(bad_out, index=False)
    print(f'Wrote {good_out} ({len(good_df)} transitions), {bad_out} ({len(bad_df)} transitions)')

    # compute stats
    if not good_df.empty and not bad_df.empty:
        min_good_sh = good_df['shoulder_move'].min()
        max_bad_sh = bad_df['shoulder_move'].max()
        shoulder_suggest = max(0.03, (min_good_sh + max_bad_sh) / 2)

        max_good_wr = good_df['wrist_move'].max()
        min_bad_wr = bad_df['wrist_move'].min()
        wrist_suggest = max(0.01, (max_good_wr + min_bad_wr) / 2)

        stats_file = out / 'recomputed_thresholds_tests.txt'
        stats_file.write_text(f'shoulder={shoulder_suggest}\nwrist={wrist_suggest}\n')
        print('Suggested thresholds:', shoulder_suggest, wrist_suggest)
        print('Saved to', stats_file)
    else:
        print('Not enough data to compute thresholds (need both good and bad transitions)')


if __name__ == '__main__':
    main()
