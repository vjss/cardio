
fetch("/api/status")
    .then(response => response.json())
    .then(data => {
        document.getElementById("overview-model").textContent =
            data.trained ? "Ready" : "Not trained";
    })
    .catch(() => {
        document.getElementById("overview-model").textContent =
            "Offline";
    });
