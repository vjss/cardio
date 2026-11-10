
fetch("/api/metrics")
    .then(response => response.json())
    .then(data => {
        const message = document.getElementById("metrics-message");

        if (!data.trained) {
            message.textContent =
                data.message || "Train the model to view results";
            return;
        }

        message.hidden = true;

        document.getElementById("metrics-content").hidden = false;

        document.getElementById("train-count").textContent =
            Number(data.train_records).toLocaleString();

        document.getElementById("validation-count").textContent =
            Number(data.validation_records).toLocaleString();

        document.getElementById("test-count").textContent =
            Number(data.test_records).toLocaleString();

        const tbody = document.getElementById("metrics-table");
        tbody.replaceChildren();

        Object.entries(data.results || {}).forEach(([name, values]) => {
            const tr = document.createElement("tr");

            [
                name,
                values.macro_f1 ?? "—",
                values.macro_auroc ?? "—"
            ].forEach(value => {
                const td = document.createElement("td");
                td.textContent = value;
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
    })
    .catch(() => {
        document.getElementById("metrics-message").textContent =
            "Unable to load evaluation metrics.";
    });
