
import argparse
import ast
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import wfdb

from sklearn.ensemble import ExtraTreesClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.pipeline import make_pipeline

ROOT = Path(__file__).resolve().parent

DATASET = (
    ROOT.parent
    / "ptb-xl-1.0.3"
    / "ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3"
)

LABELS = ["NORM", "MI", "STTC", "CD", "HYP"]
CLINICAL = ["age", "sex", "height", "weight"]


def ecg_features(signal):
    x = np.asarray(signal, dtype=float)

    if x.shape != (1000, 12) or not np.isfinite(x).all():
        raise ValueError("Expected finite 1000 x 12 ECG")

    return np.concatenate([
        x.mean(axis=0),
        x.std(axis=0),
        np.abs(np.diff(x, axis=0)).mean(axis=0),
        np.ptp(x, axis=0),
        np.percentile(x, 5, axis=0),
        np.percentile(x, 95, axis=0)
    ])


def quality(signal):
    x = np.asarray(signal, dtype=float)

    if x.shape != (1000, 12) or not np.isfinite(x).all():
        return 0.1

    flat = np.mean(np.std(x, axis=0) < 0.015)

    return float(np.clip(1 - flat, 0.1, 1.0))


def load_data(base):
    for item in ["ptbxl_database.csv", "scp_statements.csv"]:
        if not (base / item).is_file():
            raise FileNotFoundError(f"Missing: {base / item}")

    if not (base / "records100").is_dir():
        raise FileNotFoundError("Missing records100 folder")

    df = pd.read_csv(base / "ptbxl_database.csv")

    scp = pd.read_csv(
        base / "scp_statements.csv",
        index_col=0
    )

    diagnostic = scp.loc[
        scp["diagnostic"] == 1,
        "diagnostic_class"
    ].dropna().to_dict()

    e, c, y, folds, q = [], [], [], [], []

    for i, row in df.iterrows():
        codes = ast.literal_eval(row["scp_codes"])

        classes = {
            diagnostic[k]
            for k in codes
            if k in diagnostic and diagnostic[k] in LABELS
        }

        if not classes:
            continue

        try:
            signal, _ = wfdb.rdsamp(
                str(base / row["filename_lr"])
            )
            features = ecg_features(signal)
        except (OSError, ValueError, KeyError) as error:
            print("Skipped ECG:", row["ecg_id"], error)
            continue

        e.append(features)
        c.append([row.get(k, np.nan) for k in CLINICAL])
        y.append([int(k in classes) for k in LABELS])
        folds.append(int(row["strat_fold"]))
        q.append(quality(signal))

        if (i + 1) % 1000 == 0:
            print(f"Processed {i + 1}/{len(df)}")

    if not y:
        raise RuntimeError("No ECG recordings loaded")

    return tuple(
        np.asarray(item)
        for item in (e, c, y, folds, q)
    )


def make_model(seed):
    return make_pipeline(
        SimpleImputer(
            strategy="median",
            keep_empty_features=True
        ),
        ExtraTreesClassifier(
            n_estimators=220,
            min_samples_leaf=3,
            max_features="sqrt",
            class_weight="balanced",
            n_jobs=-1,
            random_state=seed
        )
    )


def probs(models, x):
    return np.column_stack([
        models[k].predict_proba(x)[:, 1]
        for k in LABELS
    ])


def blend(ecg, clinical, eq, cq, alpha):
    alpha = np.asarray(alpha).reshape(1, -1)

    w = (
        alpha * eq[:, None]
        / (
            alpha * eq[:, None]
            + (1 - alpha) * cq[:, None]
            + 1e-8
        )
    )

    return w * ecg + (1 - w) * clinical, w


def choose_thresholds(y, probabilities):
    candidates = np.arange(0.15, 0.851, 0.025)
    thresholds = []

    for j in range(y.shape[1]):
        scores = [
            f1_score(
                y[:, j],
                probabilities[:, j] >= t,
                zero_division=0
            )
            for t in candidates
        ]

        thresholds.append(
            float(candidates[int(np.argmax(scores))])
        )

    return np.asarray(thresholds)


def metrics(y, probabilities, thresholds):
    result = {
        "macro_f1": round(
            float(
                f1_score(
                    y,
                    probabilities >= thresholds,
                    average="macro",
                    zero_division=0
                )
            ),
            4
        )
    }

    try:
        result["macro_auroc"] = round(
            float(roc_auc_score(y, probabilities, average="macro")),
            4
        )
    except ValueError:
        result["macro_auroc"] = None

    return result


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--data",
        default=str(DATASET)
    )

    args = parser.parse_args()
    base = Path(args.data).resolve()

    print("Dataset:", base)

    e, c, y, fold, q = load_data(base)

    c = c.astype(float)
    y = y.astype(int)
    fold = fold.astype(int)
    q = q.astype(float)

    tr = fold <= 8
    va = fold == 9
    te = fold == 10

    if min(tr.sum(), va.sum(), te.sum()) == 0:
        raise RuntimeError("Missing train/validation/test folds")

    print(
        "Train/Validation/Test:",
        int(tr.sum()),
        int(va.sum()),
        int(te.sum())
    )

    em, cm = {}, {}

    for j, label in enumerate(LABELS):
        if np.unique(y[tr, j]).size < 2:
            raise RuntimeError("Insufficient examples for " + label)

        print("Training:", label, flush=True)

        em[label] = make_model(42 + j).fit(
            e[tr], y[tr, j]
        )

        cm[label] = make_model(142 + j).fit(
            c[tr], y[tr, j]
        )

    ev, cv = probs(em, e[va]), probs(cm, c[va])
    et, ct = probs(em, e[te]), probs(cm, c[te])

    cvq = np.isfinite(c[va]).mean(axis=1)
    ctq = np.isfinite(c[te]).mean(axis=1)

    alpha = []

    for j in range(len(LABELS)):
        candidates = np.arange(0.1, 0.91, 0.1)
        scores = []

        for a in candidates:
            fused, _ = blend(
                ev[:, j:j+1],
                cv[:, j:j+1],
                q[va],
                cvq,
                [a]
            )

            threshold = choose_thresholds(
                y[va, j:j+1],
                fused
            )[0]

            scores.append(
                f1_score(
                    y[va, j],
                    fused[:, 0] >= threshold,
                    zero_division=0
                )
            )

        alpha.append(
            float(candidates[int(np.argmax(scores))])
        )

    validations = {
        "ECG only": ev,
        "Metadata only": cv,
        "Fixed fusion": 0.5 * ev + 0.5 * cv,
        "Quality-aware heuristic": blend(
            ev, cv, q[va], cvq, alpha
        )[0]
    }

    tests = {
        "ECG only": et,
        "Metadata only": ct,
        "Fixed fusion": 0.5 * et + 0.5 * ct,
        "Quality-aware heuristic": blend(
            et, ct, q[te], ctq, alpha
        )[0]
    }

    thresholds = {
        name: choose_thresholds(y[va], probabilities)
        for name, probabilities in validations.items()
    }

    results = {
        name: metrics(y[te], probabilities, thresholds[name])
        for name, probabilities in tests.items()
    }

    out = ROOT / "artifacts"
    out.mkdir(exist_ok=True)

    joblib.dump(
        {
            "ecg": em,
            "clinical": cm,
            "labels": LABELS,
            "clinical_columns": CLINICAL,
            "alpha": alpha,
            "thresholds": thresholds[
                "Quality-aware heuristic"
            ].tolist()
        },
        out / "models.joblib"
    )

    (out / "metrics.json").write_text(
        json.dumps(
            {
                "train_records": int(tr.sum()),
                "validation_records": int(va.sum()),
                "test_records": int(te.sum()),
                "results": results,
                "thresholds": {
                    k: v.tolist()
                    for k, v in thresholds.items()
                },
                "model_type": "ExtraTrees feature-based baseline"
            },
            indent=2
        ),
        encoding="utf-8"
    )

    print(json.dumps(results, indent=2))
    print("Saved:", out / "models.joblib")


if __name__ == "__main__":
    main()
