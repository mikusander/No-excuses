#!/usr/bin/env python3
"""Cerca soglie che massimizzano TP con un vincolo su FP.

Usage:
  python scripts/search_thresholds_fp_cap.py --base "dati di debug" --out "dati di debug/analysis_output" --fp-cap 2
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
    parser.add_argument('--out', default='dati di debug/analysis_output')
    parser.add_argument('--fp-cap', type=int, default=2)
    parser.add_argument('--grid', type=int, default=80)
    args = parser.parse_args()

    base = Path(args.base)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    good, bad = load_transitions(base)

    all_sh = pd.concat([good['shoulder_move'], bad['shoulder_move']]).dropna()
    all_wr = pd.concat([good['wrist_move'], bad['wrist_move']]).dropna()
    sh_min, sh_max = max(0.0, all_sh.min()*0.5), all_sh.max()*1.2
    wr_min, wr_max = max(0.0, all_wr.min()*0.5), all_wr.max()*1.5

    sh_vals = np.linspace(sh_min, sh_max, args.grid)
    wr_vals = np.linspace(wr_min, wr_max, args.grid)

    results = []
    best = None

    for sh in sh_vals:
        for wr in wr_vals:
            tp, fp = evaluate(good, bad, sh, wr)
            if fp <= args.fp_cap:
                results.append({'shoulder': sh, 'wrist': wr, 'tp': tp, 'fp': fp})
                if best is None or tp > best['tp'] or (tp == best['tp'] and fp < best['fp']):
                    best = {'shoulder': sh, 'wrist': wr, 'tp': tp, 'fp': fp}

    results_df = pd.DataFrame(results)
    results_file = out / 'threshold_search_fp_cap_results.csv'
    results_df.to_csv(results_file, index=False)

    best_file = out / 'threshold_search_fp_cap_best.txt'
    if best:
        best_file.write_text(
            f"shoulder={best['shoulder']}\n"
            f"wrist={best['wrist']}\n"
            f"tp={best['tp']}\n"
            f"fp={best['fp']}\n"
        )
        print('Best:', best)
    else:
        best_file.write_text('no solution under fp cap\n')
        print('No solution under fp cap')

    print('Wrote', results_file, best_file)


if __name__ == '__main__':
    main()
