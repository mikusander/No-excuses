#!/usr/bin/env python3
"""Verifica le soglie attuali su cartelle di test e genera un report.

Usage:
  python scripts/verify_thresholds.py --base "dati di debug" --out "dati di debug/analysis_output/verification"
"""
from pathlib import Path
import argparse
import glob
import pandas as pd
import numpy as np


def read_thresholds(th_file: Path):
    if not th_file.exists():
        return None
    txt = th_file.read_text().strip().splitlines()
    d = {}
    for line in txt:
        if '=' in line:
            k, v = line.split('=', 1)
            try:
                d[k.strip()] = float(v.strip())
            except:
                pass
    return d


def find_files_in_dirs(base: Path, dirs):
    files = []
    for d in dirs:
        p = base / d
        if not p.exists():
            continue
        files += sorted(glob.glob(str(p / "mediapipe-debug-*.csv")))
    return files


def find_test_csv(base: Path, name: str):
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
                transitions.append({'down_idx': down_snapshot['idx'], 'up_idx': up_snapshot['idx'],
                                    'down_ms': down_snapshot['elapsed_ms'], 'up_ms': up_snapshot['elapsed_ms'],
                                    'shoulder_move': shoulder_move, 'left_move': left_move, 'right_move': right_move, 'wrist_move': wrist_move})
            state = 'UP'
            down_snapshot = None
    return transitions


def classify_transitions(df_trans, shoulder_th, wrist_th):
    if df_trans.empty:
        return df_trans
    df = df_trans.copy()
    df['is_valid'] = df.apply(lambda r: (r['shoulder_move'] >= shoulder_th) and ( (np.isnan(r['wrist_move']) and True) or (r['wrist_move'] < wrist_th) ), axis=1)
    return df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='dati di debug')
    parser.add_argument('--out', default='dati di debug/analysis_output/verification')
    parser.add_argument('--thresholds', default='dati di debug/analysis_output/recomputed_thresholds_tests.txt')
    args = parser.parse_args()

    base = Path(args.base)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    th_file = Path(args.thresholds)
    th = read_thresholds(th_file) or {}
    shoulder_th = th.get('shoulder', 0.41426925)
    wrist_th = th.get('wrist', 0.38108425)

    test1 = find_test_csv(base, '1°')
    test2 = find_test_csv(base, '2°')
    test3 = find_test_csv(base, '3°')
    test4 = find_test_csv(base, '4°')
    test5 = find_test_csv(base, '5°')

    rows = []
    if test1 or test2 or test3 or test4 or test5:
        for fp in [test1, test2]:
            if not fp:
                continue
            frames = frames_from_csv(fp)
            start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
            if start_idx is not None:
                frames = frames.iloc[start_idx:].reset_index(drop=True)
            trans = extract_transitions(frames)
            for t in trans:
                t['source'] = str(fp)
                t['label'] = 'GOOD'
                rows.append(t)

        if test3:
            frames = frames_from_csv(test3)
            start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
            if start_idx is not None:
                frames = frames.iloc[start_idx:].reset_index(drop=True)
            trans = extract_transitions(frames)
            for idx, t in enumerate(trans):
                t['source'] = str(test3)
                t['label'] = 'GOOD' if idx < 10 else 'BAD'
                rows.append(t)

        if test4:
            frames = frames_from_csv(test4)
            start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
            if start_idx is not None:
                frames = frames.iloc[start_idx:].reset_index(drop=True)
            trans = extract_transitions(frames)
            for t in trans:
                t['source'] = str(test4)
                t['label'] = 'BAD'
                rows.append(t)

        if test5:
            frames = frames_from_csv(test5)
            start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
            if start_idx is not None:
                frames = frames.iloc[start_idx:].reset_index(drop=True)
            trans = extract_transitions(frames)
            for t in trans:
                t['source'] = str(test5)
                t['label'] = 'BAD'
                rows.append(t)
    else:
        good_dirs = ['1° test', '2° test', '4° test']
        bad_dirs = ['5° test']
        good_files = find_files_in_dirs(base, good_dirs)
        bad_files = find_files_in_dirs(base, bad_dirs)

        for f in good_files:
            frames = frames_from_csv(Path(f))
            start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
            if start_idx is not None:
                frames = frames.iloc[start_idx:].reset_index(drop=True)
            trans = extract_transitions(frames)
            for t in trans:
                t['source'] = f
                t['label'] = 'GOOD'
                rows.append(t)

        for f in bad_files:
            frames = frames_from_csv(Path(f))
            start_idx = detect_sinusoidal_start(frames['shoulder_to_bar'])
            if start_idx is not None:
                frames = frames.iloc[start_idx:].reset_index(drop=True)
            trans = extract_transitions(frames)
            for t in trans:
                t['source'] = f
                t['label'] = 'BAD'
                rows.append(t)

    df = pd.DataFrame(rows)
    if df.empty:
        print('No transitions found.')
        return

    classified = classify_transitions(df, shoulder_th, wrist_th)
    out_csv = out / 'transitions_classified.csv'
    classified.to_csv(out_csv, index=False)

    # summary
    total_good = len(classified[classified['label']=='GOOD'])
    tp = len(classified[(classified['label']=='GOOD') & (classified['is_valid'])])
    total_bad = len(classified[classified['label']=='BAD'])
    fp = len(classified[(classified['label']=='BAD') & (classified['is_valid'])])

    report = (
        f'Thresholds used: shoulder={shoulder_th} wrist={wrist_th}\n'
        f'GOOD transitions: {total_good}, valid (TP): {tp}, TPR: {tp/total_good if total_good else 0:.2f}\n'
        f'BAD transitions: {total_bad}, valid (FP): {fp}, FPR: {fp/total_bad if total_bad else 0:.2f}\n'
    )
    (out / 'verification_report.txt').write_text(report)
    print(report)
    print('Classified transitions saved to', out_csv)


if __name__ == '__main__':
    main()
