#!/usr/bin/env python3
"""
Derive per-lead morphology profiles from PTB-XL, so the generator can be
calibrated against real recordings instead of hand-tuned constants.

    pip install wfdb numpy pandas
    python tools/ptbxl_profile.py "D:/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3"

Writes public/assets/data/ptbxl-profiles.json: a few hundred KB of AGGREGATE
statistics — a median beat and amplitude summary per diagnosis, per lead.

It reads the dataset in place. No patient recording is copied, moved or
redistributed; only medians computed across hundreds of records leave your
machine. PTB-XL is published under CC BY 4.0 — the attribution block required
by that licence is written into the output file automatically.

Runtime is roughly 5-15 minutes for the default sample. Use --limit-per-class
to make it quicker while testing, or --fs 100 to read the smaller record set.
"""

import argparse
import ast
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
import pandas as pd

try:
    import wfdb
except ImportError:
    sys.exit("Missing dependency. Run:  pip install wfdb numpy pandas")

LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']

# PTB-XL diagnostic subclasses worth profiling, mapped to the generator's own
# vocabulary. The left-hand key is the SCP diagnostic_subclass in the dataset.
CLASSES = {
    'NORM':  'normal sinus rhythm',
    'IMI':   'inferior MI',
    'AMI':   'anterior MI',
    'ASMI':  'anteroseptal MI',
    'ALMI':  'anterolateral MI',
    'LMI':   'lateral MI',
    'PMI':   'posterior MI',
    'IPMI':  'inferoposterior MI',
    'ISCA':  'anterior ischemia',
    'ISCI':  'inferior ischemia',
    'STTC':  'nonspecific ST/T change',
    'NST_':  'nonspecific ST change',
    'LVH':   'left ventricular hypertrophy',
    'RVH':   'right ventricular hypertrophy',
    'CLBBB': 'complete LBBB',
    'CRBBB': 'complete RBBB',
    'IRBBB': 'incomplete RBBB',
    'ILBBB': 'incomplete LBBB',
    'LAFB':  'left anterior fascicular block',
    'IVCD':  'intraventricular conduction delay',
    'WPW':   'pre-excitation',
    'LAO/LAE': 'left atrial enlargement',
    'RAO/RAE': 'right atrial enlargement',
}

WIN_PRE_MS = 250      # window starts this far before the R peak
WIN_POST_MS = 450     # ...and ends this far after it
OUT_FS = 250          # median beats are stored at this rate to keep the file small


def detect_r_peaks(sig, fs):
    """Locate R peaks using the vector magnitude across all leads.

    Using the magnitude rather than a single lead matters: in plenty of real
    records lead II is nearly isoelectric, and a single-lead detector then
    either misses beats or locks onto the T wave.
    """
    mag = np.sqrt((sig ** 2).sum(axis=1))
    deriv = np.diff(mag, prepend=mag[0])
    energy = deriv ** 2
    width = max(1, int(0.06 * fs))
    smooth = np.convolve(energy, np.ones(width) / width, mode='same')

    thresh = np.percentile(smooth, 97) * 0.30
    if thresh <= 0:
        return np.array([], dtype=int)

    refractory = int(0.24 * fs)
    peaks, i, n = [], 0, len(smooth)
    while i < n:
        if smooth[i] > thresh:
            stop = min(n, i + refractory)
            peaks.append(int(np.argmax(mag[i:stop]) + i))
            i = stop
        else:
            i += 1
    return np.array(peaks, dtype=int)


def median_beat(sig, fs):
    """Median P-QRS-T for one record, per lead, baseline-corrected, in mV."""
    pre, post = int(WIN_PRE_MS * fs / 1000), int(WIN_POST_MS * fs / 1000)
    peaks = detect_r_peaks(sig, fs)
    peaks = [p for p in peaks if p - pre >= 0 and p + post < len(sig)]
    if len(peaks) < 3:
        return None

    beats = np.stack([sig[p - pre:p + post, :] for p in peaks])   # (beats, samples, leads)

    # Baseline: the flat stretch well before the R peak, which lands on the
    # PR segment or just ahead of the P wave at normal rates.
    base_hi = int((WIN_PRE_MS - 40) * fs / 1000)
    baseline = np.median(beats[:, :max(4, base_hi), :], axis=1, keepdims=True)
    beats = beats - baseline

    med = np.median(beats, axis=0)                                 # (samples, leads)

    # Reject records where the beats disagree wildly — usually a failed
    # detection or heavy artifact, and averaging those in blurs the template.
    spread = np.median(np.abs(beats - med).mean(axis=(1, 2)))
    if spread > 0.25:
        return None
    return med


def resample_to(beat, fs, out_fs):
    n_out = int(round(beat.shape[0] * out_fs / fs))
    src = np.linspace(0, 1, beat.shape[0])
    dst = np.linspace(0, 1, n_out)
    return np.stack([np.interp(dst, src, beat[:, i]) for i in range(beat.shape[1])], axis=1)


def summarise(beat, out_fs):
    """Amplitude and ST measurements taken off a class median beat."""
    r_idx = int(WIN_PRE_MS * out_fs / 1000)
    out = {}
    for i, lead in enumerate(LEADS):
        w = beat[:, i]
        qrs_lo = r_idx - int(0.06 * out_fs)
        qrs_hi = r_idx + int(0.06 * out_fs)
        qrs = w[max(0, qrs_lo):qrs_hi]
        t_lo = r_idx + int(0.16 * out_fs)
        t_hi = r_idx + int(0.40 * out_fs)
        t_seg = w[t_lo:min(len(w), t_hi)]
        j40 = r_idx + int(0.09 * out_fs)      # ~J point + 40 ms for a normal QRS
        out[lead] = {
            'r_mv': round(float(qrs.max()), 4),
            's_mv': round(float(qrs.min()), 4),
            't_mv': round(float(t_seg[np.argmax(np.abs(t_seg))]), 4) if len(t_seg) else 0.0,
            'st_j40_mv': round(float(w[j40]), 4) if j40 < len(w) else 0.0,
        }
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('root', help='PTB-XL folder (the one containing ptbxl_database.csv)')
    ap.add_argument('-o', '--out', default=os.path.join('public', 'assets', 'data', 'ptbxl-profiles.json'))
    ap.add_argument('--fs', type=int, choices=(100, 500), default=500,
                    help='which record set to read (default 500)')
    ap.add_argument('--limit-per-class', type=int, default=150,
                    help='max records averaged per diagnosis (default 150; '
                         'medians are stable well before this, so raising it '
                         'mostly just costs time)')
    ap.add_argument('--min-likelihood', type=int, default=80,
                    help='minimum SCP statement likelihood to accept (default 80)')
    args = ap.parse_args()

    root = args.root
    db_path = os.path.join(root, 'ptbxl_database.csv')
    if not os.path.isfile(db_path):
        sys.exit(f"Could not find ptbxl_database.csv in {root!r}.\n"
                 f"Point this at the folder that contains it.")

    print(f"Reading {db_path}")
    db = pd.read_csv(db_path, index_col='ecg_id')
    db.scp_codes = db.scp_codes.apply(ast.literal_eval)

    scp = pd.read_csv(os.path.join(root, 'scp_statements.csv'), index_col=0)
    scp = scp[scp.diagnostic == 1]
    sub_of = scp.diagnostic_subclass.to_dict()

    # Bucket records by diagnostic subclass, keeping only confident statements.
    buckets = defaultdict(list)
    for ecg_id, codes in db.scp_codes.items():
        subs = {sub_of[c] for c, likelihood in codes.items()
                if c in sub_of and likelihood >= args.min_likelihood}
        # One diagnosis at a time gives a clean template; mixed records blur it.
        if len(subs) == 1:
            sub = subs.pop()
            if sub in CLASSES:
                buckets[sub].append(ecg_id)

    print("Records available per class:")
    for k in sorted(buckets, key=lambda x: -len(buckets[x])):
        print(f"   {k:10s} {len(buckets[k]):5d}")

    col = 'filename_lr' if args.fs == 100 else 'filename_hr'
    profiles = {}

    for cls, ids in sorted(buckets.items()):
        ids = ids[:args.limit_per_class]
        if len(ids) < 10:
            print(f"skipping {cls}: only {len(ids)} records")
            continue

        print(f"\n{cls} ({CLASSES[cls]}) — averaging {len(ids)} records", flush=True)
        stack, used = [], 0
        for n, ecg_id in enumerate(ids, 1):
            rec_path = os.path.join(root, db.loc[ecg_id, col])
            try:
                sig, meta = wfdb.rdsamp(rec_path)
            except Exception:
                continue
            beat = median_beat(np.asarray(sig, dtype=float), meta['fs'])
            if beat is None:
                continue
            stack.append(resample_to(beat, meta['fs'], OUT_FS))
            used += 1
            if n % 50 == 0:
                print(f"   {n}/{len(ids)} read, {used} usable", flush=True)

        if used < 10:
            print(f"   too few usable records ({used}), skipping")
            continue

        med = np.median(np.stack(stack), axis=0)
        profiles[cls] = {
            'label': CLASSES[cls],
            'n_records': used,
            'measurements': summarise(med, OUT_FS),
            'median_beat_mv': {
                lead: [round(float(v), 4) for v in med[:, i]]
                for i, lead in enumerate(LEADS)
            },
        }
        print(f"   done: {used} records averaged")

    payload = {
        'source': {
            'dataset': 'PTB-XL, a large publicly available electrocardiography dataset (v1.0.3)',
            'authors': 'Wagner, P., Strodthoff, N., Bousseljot, R.-D., Samek, W., Schaeffter, T.',
            'published_by': 'PhysioNet',
            'url': 'https://physionet.org/content/ptb-xl/1.0.3/',
            'licence': 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
            'note': ('Aggregate statistics only. These are medians computed across hundreds of '
                     'records; no individual patient recording is reproduced here.'),
        },
        'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'sample_rate_hz': OUT_FS,
        'window_ms': {'before_r': WIN_PRE_MS, 'after_r': WIN_POST_MS},
        'leads': LEADS,
        'read_from_record_set_hz': args.fs,
        'classes': profiles,
    }

    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w') as fh:
        json.dump(payload, fh, separators=(',', ':'))

    size_kb = os.path.getsize(args.out) / 1024
    print(f"\nWrote {args.out}  ({size_kb:.0f} KB, {len(profiles)} classes)")
    print("Commit that file and the generator can be calibrated against it.")


if __name__ == '__main__':
    main()
