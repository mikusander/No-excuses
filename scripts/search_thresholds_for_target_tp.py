#!/usr/bin/env python3
"""Trova soglie che producono circa `target_tp` veri positivi sui GOOD minimizzando FP sui BAD.

Usage:
  python scripts/search_thresholds_for_target_tp.py --base "dati di debug" --out "dati di debug/analysis_output" --target 10
"""
from pathlib import Path
import argparse
import pandas as pd
import numpy as np


def load_transitions(base: Path):
    good_fp = base / 'analysis_output' / 'good_transitions.csv'
    bad_fp = base / 'analysis_output' / 'bad_transitions.csv'
    if not good_fp.exists() or not bad_fp.exists():
        raise FileNotFoundError('good_transitions.csv or bad_transitions.csv missing in analysis_output')
    good = pd.read_csv(good_fp)
    bad = pd.read_csv(bad_fp)
    return good, bad


def evaluate_thresholds(good, bad, shoulder_th, wrist_th):
    def valid_row(r):
        wm = r['wrist_move']
        wrist_ok = True if np.isnan(wm) else (wm < wrist_th)
        return (r['shoulder_move'] >= shoulder_th) and wrist_ok

    tp = good.apply(valid_row, axis=1).sum()
    fp = bad.apply(valid_row, axis=1).sum()
    return int(tp), int(fp)


def search(good, bad, target_tp=10, shoulder_grid=50, wrist_grid=50):
    all_sh = pd.concat([good['shoulder_move'], bad['shoulder_move']]).dropna()
    all_wr = pd.concat([good['wrist_move'], bad['wrist_move']]).dropna()
    sh_min, sh_max = max(0.0, all_sh.min()*0.5), all_sh.max()*1.2
    wr_min, wr_max = max(0.0, all_wr.min()*0.5), all_wr.max()*1.5

    sh_vals = np.linspace(sh_min, sh_max, shoulder_grid)
    wr_vals = np.linspace(wr_min, wr_max, wrist_grid)

    results = []
    best = None
    best_score = None

    for sh in sh_vals:
        for wr in wr_vals:
            tp, fp = evaluate_thresholds(good, bad, sh, wr)
            # score: primary aim reach target_tp (distance), secondary minimize fp
            score = (abs(tp - target_tp), fp)
            results.append({'shoulder': sh, 'wrist': wr, 'tp': tp, 'fp': fp})
            if best_score is None or score < best_score:
                best_score = score
                best = {'shoulder': sh, 'wrist': wr, 'tp': tp, 'fp': fp}

    return pd.DataFrame(results), best


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='dati di debug')
    parser.add_argument('--out', default='dati di debug/analysis_output')
    parser.add_argument('--target', type=int, default=10)
    args = parser.parse_args()

    base = Path(args.base)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    good, bad = load_transitions(base)
    results_df, best = search(good, bad, target_tp=args.target, shoulder_grid=80, wrist_grid=80)

    results_file = out / 'threshold_search_results.csv'
    results_df.to_csv(results_file, index=False)
    best_file = out / 'threshold_search_best.txt'
    best_file.write_text(f"shoulder={best['shoulder']}\nwrist={best['wrist']}\ntp={best['tp']}\nfp={best['fp']}\n")
    print('Wrote', results_file, 'best:', best)

if __name__ == '__main__':
    main()
