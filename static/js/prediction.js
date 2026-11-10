
const form = document.getElementById("prediction-form");
const fileInput = document.getElementById("ecg-file");
const fileLabel = document.getElementById("file-label");
const errorBox = document.getElementById("prediction-error");
const button = document.getElementById("analyze-button");

const pct = value => (100 * Number(value)).toFixed(1) + "%";

fileInput.addEventListener("change", () => {
    fileLabel.textContent =
        fileInput.files[0]?.name || "Select ECG CSV";
});

fetch("/api/status")
    .then(response => response.json())
    .then(data => {
        document.getElementById("prediction-status").textContent =
            data.trained ? "Model ready" : "Training required";
    });

form.addEventListener("submit", async event => {
    event.preventDefault();

    errorBox.hidden = true;

    if (!fileInput.files.length) {
        errorBox.textContent = "Choose an ECG CSV file.";
        errorBox.hidden = false;
        return;
    }

    const formData = new FormData(form);
    formData.set("ecg", fileInput.files[0]);

    button.disabled = true;
    button.textContent = "Analyzing ECG...";

    try {
        const response = await fetch("/api/predict", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Analysis failed");
        }

        showResults(data);

    } catch (error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
    } finally {
        button.disabled = false;
        button.textContent = "Run Analysis →";
    }
});


function showResults(data) {
    const results = document.getElementById("analysis-results");
    results.hidden = false;

    document.getElementById("ecg-quality").textContent =
        pct(data.ecg_quality);

    document.getElementById("metadata-quality").textContent =
        pct(data.metadata_completeness);

    document.getElementById("fusion-weight").textContent =
        pct(data.ecg_weight);

    const summary = document.getElementById("prediction-summary");

    summary.textContent = data.predicted_labels.length
        ? "Predicted groups: " + data.predicted_labels.join(", ")
        : "No class exceeds its selected threshold";

    const bars = document.getElementById("probability-bars");
    const tbody = document.getElementById("prediction-table");

    bars.replaceChildren();
    tbody.replaceChildren();

    const classNames = {
        NORM: "Normal ECG",
        MI: "Myocardial Infarction",
        STTC: "ST/T Changes",
        CD: "Conduction Disturbance",
        HYP: "Hypertrophy"
    };

    data.labels.forEach((label, i) => {
        const row = document.createElement("div");
        row.className = "bar-row";

        const header = document.createElement("div");
        header.className = "bar-head";

        const name = document.createElement("span");
        name.textContent = classNames[label] || label;

        const percentage = document.createElement("span");
        percentage.textContent = pct(data.fused[i]);

        header.append(name, percentage);

        const track = document.createElement("div");
        track.className = "bar-track";

        const fill = document.createElement("div");
        fill.className = "bar-fill";
        fill.style.width = pct(data.fused[i]);

        track.append(fill);
        row.append(header, track);
        bars.appendChild(row);

        const tr = document.createElement("tr");

        [
            label,
            pct(data.ecg[i]),
            pct(data.clinical[i]),
            pct(data.fixed[i]),
            pct(data.fused[i])
        ].forEach(value => {
            const td = document.createElement("td");
            td.textContent = value;
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });

    drawWaveform(data.lead_ii);

    results.scrollIntoView({
        behavior: "smooth"
    });
}


function drawWaveform(signal) {
    const canvas = document.getElementById("waveform");
    const ctx = canvas.getContext("2d");

    const width = canvas.width;
    const height = canvas.height;
    const pad = 30;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#f9fbff";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#e5edf5";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 10; i++) {
        const x = pad + (width - 2 * pad) * i / 10;

        ctx.beginPath();
        ctx.moveTo(x, pad);
        ctx.lineTo(x, height - pad);
        ctx.stroke();
    }

    for (let i = 0; i <= 5; i++) {
        const y = pad + (height - 2 * pad) * i / 5;

        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(width - pad, y);
        ctx.stroke();
    }

    const min = Math.min(...signal);
    const max = Math.max(...signal);
    const span = Math.max(max - min, 0.001);

    ctx.strokeStyle = "#0da78f";
    ctx.lineWidth = 2;
    ctx.beginPath();

    signal.forEach((value, i) => {
        const x = pad + (width - 2 * pad) *
            i / (signal.length - 1);

        const y = height - pad -
            (height - 2 * pad) * (value - min) / span;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    ctx.fillStyle = "#73849c";
    ctx.font = "12px sans-serif";
    ctx.fillText("0 s", pad, height - 8);
    ctx.fillText("10 s", width - 57, height - 8);
}
