
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("year").textContent =
        new Date().getFullYear();

    document.getElementById("menu-button")
        ?.addEventListener("click", () => {
            document.getElementById("sidebar")
                .classList.toggle("open");
        });

    loadStatus();

    if (document.getElementById("dashboard-wave")) {
        loadDashboard();
    }

    if (document.getElementById("ecg-form")) {
        setupPrediction();
    }

    if (document.getElementById("metrics-content")) {
        loadMetrics();
    }
});

const percentage = n => (Number(n) * 100).toFixed(1) + "%";

const classNames = {
    NORM: "Normal ECG",
    MI: "Myocardial Infarction",
    STTC: "ST/T Changes",
    CD: "Conduction Disturbance",
    HYP: "Hypertrophy"
};

async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("Server request failed");
    }
    return response.json();
}

async function loadStatus() {
    try {
        const data = await getJSON("/api/status");
        const label = data.trained ? "Model Ready" : "Training Required";

        document.getElementById("side-status").textContent = label;
        document.getElementById("top-status").textContent = label;

        const dashboard = document.getElementById("dashboard-status");
        if (dashboard) {
            dashboard.textContent = data.trained ? "Ready" : "Not Trained";
        }
    } catch {
        document.getElementById("side-status").textContent = "Server Error";
        document.getElementById("top-status").textContent = "Unavailable";
    }
}

/* ECG GRAPH */

function drawECG(canvas, signal) {
    if (!canvas || !signal || signal.length < 2) return;

    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const pad = 30;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fbfdff";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#e4edf4";
    ctx.lineWidth = 1;

    for (let x = pad; x < W - pad; x += 25) {
        ctx.beginPath();
        ctx.moveTo(x, pad);
        ctx.lineTo(x, H - pad);
        ctx.stroke();
    }

    for (let y = pad; y < H - pad; y += 25) {
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(W - pad, y);
        ctx.stroke();
    }

    const min = Math.min(...signal);
    const max = Math.max(...signal);
    const span = Math.max(max - min, 0.001);

    ctx.strokeStyle = "#0ca58d";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();

    signal.forEach((value, i) => {
        const x = pad + i / (signal.length - 1) * (W - 2 * pad);
        const y = H - pad - (value - min) / span * (H - 2 * pad);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    ctx.fillStyle = "#74839a";
    ctx.font = "12px Arial";
    ctx.fillText("0 s", pad, H - 8);
    ctx.fillText("10 s", W - pad - 30, H - 8);
}

function demoSignal() {
    const data = [];

    for (let i = 0; i < 500; i++) {
        const t = i / 50;
        const phase = t % 0.9;

        const gaussian = (x, center, width, amp) =>
            amp * Math.exp(-Math.pow((x - center) / width, 2));

        const value =
            gaussian(phase, 0.15, 0.035, 0.12) -
            gaussian(phase, 0.35, 0.012, 0.15) +
            gaussian(phase, 0.375, 0.009, 1.1) -
            gaussian(phase, 0.4, 0.014, 0.25) +
            gaussian(phase, 0.6, 0.09, 0.24);

        data.push(value);
    }

    return data;
}

/* DASHBOARD */

async function loadDashboard() {
    drawECG(
        document.getElementById("dashboard-wave"),
        demoSignal()
    );

    try {
        const data = await getJSON("/api/metrics");
        if (!data.trained) return;

        const results = data.results || {};
        const selected =
            results["Quality-aware heuristic"] ||
            results["Quality-aware fusion"] ||
            results["Adaptive fusion"];

        if (!selected) return;

        document.getElementById("dashboard-f1").textContent =
            selected.macro_f1 == null
                ? "N/A"
                : Number(selected.macro_f1).toFixed(3);

        document.getElementById("dashboard-auroc").textContent =
            selected.macro_auroc == null
                ? "N/A"
                : Number(selected.macro_auroc).toFixed(3);

        document.getElementById("dashboard-tests").textContent =
            Number(data.test_records).toLocaleString();

    } catch (error) {
        console.error("Dashboard metrics:", error);
    }
}

/* PREDICTION */

function setupPrediction() {
    const form = document.getElementById("ecg-form");
    const file = document.getElementById("ecg-file");
    const selected = document.getElementById("selected-file");
    const button = document.getElementById("analyze-btn");
    const errorBox = document.getElementById("analysis-error");

    file.addEventListener("change", () => {
        selected.textContent =
            file.files[0]?.name || "Choose an ECG CSV file";
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        errorBox.hidden = true;

        if (!file.files.length) {
            errorBox.textContent = "Select an ECG CSV file.";
            errorBox.hidden = false;
            return;
        }

        button.disabled = true;
        button.textContent = "Analyzing ECG...";

        try {
            const formData = new FormData(form);

            const response = await fetch("/api/predict", {
                method: "POST",
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Prediction failed");
            }

            showPrediction(data);

        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
        } finally {
            button.disabled = false;
            button.textContent = "Analyze ECG →";
        }
    });
}

function showPrediction(data) {
    const results = document.getElementById("results");
    results.hidden = false;

    document.getElementById("result-quality").textContent =
        percentage(data.ecg_quality);

    document.getElementById("result-completeness").textContent =
        percentage(data.metadata_completeness);

    document.getElementById("result-weight").textContent =
        percentage(data.ecg_weight);

    drawECG(
        document.getElementById("result-wave"),
        data.lead_ii
    );

    const summary = document.getElementById("prediction-summary");
    const predicted = data.predicted_labels || [];

    summary.textContent = predicted.length
        ? "Predicted groups: " + predicted.join(", ")
        : "No diagnostic group exceeded its decision threshold.";

    const bars = document.getElementById("score-bars");
    const rows = document.getElementById("prediction-rows");

    bars.replaceChildren();
    rows.replaceChildren();

    data.labels.forEach((label, index) => {
        const score = Number(data.fused[index]);

        const item = document.createElement("div");
        item.className = "score-item";

        const head = document.createElement("div");
        head.className = "score-heading";

        const name = document.createElement("span");
        name.textContent = classNames[label] || label;

        const value = document.createElement("strong");
        value.textContent = percentage(score);

        head.append(name, value);

        const track = document.createElement("div");
        track.className = "progress-track";

        const fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = percentage(score);

        track.appendChild(fill);
        item.append(head, track);
        bars.appendChild(item);

        const tr = document.createElement("tr");

        [
            label,
            percentage(data.ecg[index]),
            percentage(data.clinical[index]),
            percentage(data.fixed[index]),
            percentage(data.fused[index])
        ].forEach(text => {
            const td = document.createElement("td");
            td.textContent = text;
            tr.appendChild(td);
        });

        rows.appendChild(tr);
    });

    results.scrollIntoView({ behavior: "smooth" });
}

/* MODEL PERFORMANCE */

async function loadMetrics() {
    const notice = document.getElementById("metrics-notice");
    const content = document.getElementById("metrics-content");

    try {
        const data = await getJSON("/api/metrics");

        if (!data.trained) {
            notice.textContent =
                data.message || "Train the model to view metrics.";
            return;
        }

        notice.hidden = true;
        content.hidden = false;

        document.getElementById("train-records").textContent =
            Number(data.train_records).toLocaleString();

        document.getElementById("validation-records").textContent =
            Number(data.validation_records).toLocaleString();

        document.getElementById("test-records").textContent =
            Number(data.test_records).toLocaleString();

        const rows = document.getElementById("metrics-rows");
        const bars = document.getElementById("performance-bars");

        rows.replaceChildren();
        bars.replaceChildren();

        Object.entries(data.results || {}).forEach(([name, metrics]) => {
            const tr = document.createElement("tr");

            [
                name,
                metrics.macro_f1 == null
                    ? "N/A"
                    : Number(metrics.macro_f1).toFixed(4),
                metrics.macro_auroc == null
                    ? "N/A"
                    : Number(metrics.macro_auroc).toFixed(4)
            ].forEach(value => {
                const td = document.createElement("td");
                td.textContent = value;
                tr.appendChild(td);
            });

            rows.appendChild(tr);

            if (metrics.macro_f1 != null) {
                const item = document.createElement("div");
                item.className = "score-item";

                const heading = document.createElement("div");
                heading.className = "score-heading";

                const label = document.createElement("span");
                label.textContent = name;

                const score = document.createElement("strong");
                score.textContent =
                    Number(metrics.macro_f1).toFixed(4);

                heading.append(label, score);

                const track = document.createElement("div");
                track.className = "progress-track";

                const fill = document.createElement("div");
                fill.className = "progress-fill";
                fill.style.width =
                    (Math.max(0, Math.min(1, metrics.macro_f1)) * 100) + "%";

                track.appendChild(fill);
                item.append(heading, track);
                bars.appendChild(item);
            }
        });

    } catch (error) {
        notice.textContent = "Unable to load model evaluation results.";
        console.error(error);
    }
}
