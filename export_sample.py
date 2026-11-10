
import argparse
from pathlib import Path

import pandas as pd
import wfdb

ROOT = Path(__file__).resolve().parent

DEFAULT = (
    ROOT.parent
    / "ptb-xl-1.0.3"
    / "ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3"
)

parser = argparse.ArgumentParser()
parser.add_argument("--data", default=str(DEFAULT))
parser.add_argument("--ecg-id", type=int)

args = parser.parse_args()

base = Path(args.data).resolve()

df = pd.read_csv(base / "ptbxl_database.csv")

if args.ecg_id is None:
    row = df.iloc[0]
else:
    match = df[df["ecg_id"] == args.ecg_id]

    if match.empty:
        raise ValueError("ECG ID not found")

    row = match.iloc[0]

signal, _ = wfdb.rdsamp(
    str(base / row["filename_lr"])
)

if signal.shape != (1000, 12):
    raise ValueError("Unexpected ECG dimensions")

output = ROOT / "sample_ecg.csv"

pd.DataFrame(signal).to_csv(
    output,
    header=False,
    index=False
)

print("Sample ECG saved:", output)
print("Patient metadata:")

for column in ["age", "sex", "height", "weight"]:
    print(column, ":", row.get(column))
