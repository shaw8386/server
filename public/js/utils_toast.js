// utils_toast.js
window.toast = function (msg, duration = 2500) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.textContent = msg;
  el.style.display = "block";
  el.style.opacity = "1";

  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => {
      el.style.display = "none";
    }, 300);
  }, duration);
};
