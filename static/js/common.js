
const menu = document.getElementById("menu-toggle");

menu?.addEventListener("click", () => {
    document.querySelector(".sidebar")
        ?.classList.toggle("open");
});

fetch("/api/status")
    .then(response => response.json())
    .then(data => {
        const element = document.getElementById("sidebar-status");

        if (element) {
            element.textContent = data.trained
                ? "Trained model available"
                : "Training required";
        }
    })
    .catch(() => {
        const element = document.getElementById("sidebar-status");

        if (element) {
            element.textContent = "Backend unavailable";
        }
    });
