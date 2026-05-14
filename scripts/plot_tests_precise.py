#!/usr/bin/env python3
"""Generate higher-precision plots for each test CSV.

Usage:
  python scripts/plot_tests_precise.py --base "dati di debug" --out "dati di debug/output/plots_precise"
"""
from pathlib import Path
import argparse
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.ticker import AutoMinorLocator, FormatStrFormatter, MaxNLocator


LANDMARKS = [
    'left_shoulder', 'right_shoulder', 'left_wrist', 'right_wrist'
]


def load_frames(fp: Path) -> pd.DataFrame:
    df = pd.read_csv(fp)
    for col in ['elapsed_ms', 'x', 'y', 'z', 'visibility', 'frame_index']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    return df


def style_axes(ax):
    ax.xaxis.set_major_locator(MaxNLocator(nbins=12))
    ax.yaxis.set_major_locator(MaxNLocator(nbins=10))
    ax.xaxis.set_minor_locator(AutoMinorLocator(2))
    ax.yaxis.set_minor_locator(AutoMinorLocator(2))
    ax.yaxis.set_major_formatter(FormatStrFormatter('%.3f'))
    ax.grid(True, which='major', linestyle='-', linewidth=0.6, alpha=0.6)
    ax.grid(True, which='minor', linestyle=':', linewidth=0.4, alpha=0.4)


def plot_landmark(df: pd.DataFrame, sid: str, lm: str, out_dir: Path):
    lm_df = df[df['landmark_name'] == lm].sort_values('elapsed_ms')
    if lm_df.empty:
        return
    fig, ax = plt.subplots(figsize=(9, 4.5), dpi=200)
    ax.plot(lm_df['elapsed_ms'], lm_df['y'], linewidth=1.2)
    ax.set_title(f"{sid} — {lm} (y over time)")
    ax.set_xlabel('elapsed_ms')
    ax.set_ylabel('y')
    style_axes(ax)
    fig.tight_layout()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{sid}_{lm}.png"
    fig.savefig(out_path)
    plt.close(fig)


def plot_combined(df: pd.DataFrame, sid: str, out_dir: Path):
    comp_df = df[df['landmark_name'].isin(LANDMARKS)].sort_values('elapsed_ms')
    if comp_df.empty:
        return
    fig, ax = plt.subplots(figsize=(10, 5), dpi=200)
    for lm in LANDMARKS:
        lm_df = comp_df[comp_df['landmark_name'] == lm]
        if lm_df.empty:
            continue
        ax.plot(lm_df['elapsed_ms'], lm_df['y'], label=lm, linewidth=1.0)
    ax.set_title(f"{sid} — shoulders & wrists (y over time)")
    ax.set_xlabel('elapsed_ms')
    ax.set_ylabel('y')
    ax.legend(loc='best', fontsize=8)
    style_axes(ax)
    fig.tight_layout()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{sid}_shoulders_wrists.png"
    fig.savefig(out_path)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='dati di debug')
    parser.add_argument('--out', default='dati di debug/output/plots_precise')
    args = parser.parse_args()

    base = Path(args.base)
    out_base = Path(args.out)

    for test_name in ['1°', '2°', '3°', '4°', '5°']:
        fp = base / f"{test_name} test.csv"
        if not fp.exists():
            continue
        df = load_frames(fp)
        sid = fp.stem
        out_dir = out_base / f"{test_name} test"
        for lm in LANDMARKS:
            plot_landmark(df, sid, lm, out_dir)
        plot_combined(df, sid, out_dir)


if __name__ == '__main__':
    main()
