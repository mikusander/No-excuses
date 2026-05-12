#!/usr/bin/env python3
"""Analizza file CSV di debug MediaPipe e genera statistiche e grafici per landmark.

Uso:
  python scripts/analyze_mediapipe_debug.py --input "dati di debug" --out "dati di debug/output"

Produzione:
 - summary_{session_id}.csv per ogni sessione
 - plots/{session_id}_{landmark_name}.png

Richiede: pandas, matplotlib, seaborn
"""
import argparse
import os
from pathlib import Path
import glob
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns


def find_csv_files(input_dir: Path):
    pattern = str(input_dir / "mediapipe-debug-*.csv")
    return sorted(glob.glob(pattern))


def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)


def analyze(files, out_dir: Path, landmarks_to_plot=None):
    if not files:
        print("No CSV files found.")
        return

    dfs = [pd.read_csv(f) for f in files]
    df = pd.concat(dfs, ignore_index=True)

    # ensure numeric columns
    for col in ["elapsed_ms", "x", "y", "z", "visibility", "frame_index"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    out_dir = Path(out_dir)
    ensure_dir(out_dir)
    plots_dir = out_dir / "plots"
    ensure_dir(plots_dir)

    sessions = df['session_id'].unique()
    for sid in sessions:
        sdf = df[df['session_id'] == sid]
        summary = sdf.groupby('landmark_name').agg(
            frames=('landmark_name', 'count'),
            mean_x=('x', 'mean'),
            mean_y=('y', 'mean'),
            mean_z=('z', 'mean'),
            std_x=('x', 'std'),
            std_y=('y', 'std'),
            std_z=('z', 'std'),
            mean_visibility=('visibility', 'mean'),
            min_elapsed_ms=('elapsed_ms', 'min'),
            max_elapsed_ms=('elapsed_ms', 'max'),
        ).reset_index()

        summary_file = out_dir / f"summary_{sid}.csv"
        summary.to_csv(summary_file, index=False)
        print(f"Wrote summary: {summary_file}")

        # default landmarks to plot
        if landmarks_to_plot is None:
            landmarks_to_plot = [
                'left_shoulder', 'right_shoulder', 'left_wrist', 'right_wrist'
            ]

        for lm in landmarks_to_plot:
            lm_df = sdf[sdf['landmark_name'] == lm].sort_values('elapsed_ms')
            if lm_df.empty:
                continue
            plt.figure(figsize=(8, 4))
            sns.lineplot(x='elapsed_ms', y='y', data=lm_df)
            plt.title(f"{sid} — {lm} (y over time)")
            plt.xlabel('elapsed_ms')
            plt.ylabel('y')
            plt.tight_layout()
            out_png = plots_dir / f"{sid}_{lm}.png"
            plt.savefig(out_png)
            plt.close()
            print(f"Wrote plot: {out_png}")

        # comparison plot: shoulders + wrists if present
        comp_lms = ['left_shoulder', 'right_shoulder', 'left_wrist', 'right_wrist']
        comp_df = sdf[sdf['landmark_name'].isin(comp_lms)]
        if not comp_df.empty:
            plt.figure(figsize=(10, 5))
            sns.lineplot(data=comp_df, x='elapsed_ms', y='y', hue='landmark_name')
            plt.title(f"{sid} — shoulders & wrists (y over time)")
            plt.xlabel('elapsed_ms')
            plt.ylabel('y')
            plt.legend()
            out_png = plots_dir / f"{sid}_shoulders_wrists.png"
            plt.tight_layout()
            plt.savefig(out_png)
            plt.close()
            print(f"Wrote plot: {out_png}")


def main():
    p = argparse.ArgumentParser(description="Analizza CSV MediaPipe debug e genera statistiche e grafici")
    p.add_argument('--input', '-i', default='dati di debug', help='Cartella contenente i CSV')
    p.add_argument('--out', '-o', default='dati di debug/output', help='Cartella di output')
    p.add_argument('--plot', '-p', nargs='*', help='Lista di landmark da graficare (es: left_shoulder right_wrist)')
    args = p.parse_args()

    input_dir = Path(args.input)
    out_dir = Path(args.out)
    files = find_csv_files(input_dir)
    print(f"Found {len(files)} CSV files")
    analyze(files, out_dir, landmarks_to_plot=args.plot)


if __name__ == '__main__':
    main()
