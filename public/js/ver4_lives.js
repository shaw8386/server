console.log("🔄 ver4_live.js loaded");

function startLiveAnimation() {
  const el = document.getElementById("liveLoader");
  if (el) {
    el.style.display = "block";
    el.innerHTML = `
      <div style="text-align:center; margin-top:20px;">
        <div style="font-size:40px; animation: spin 1s linear infinite;">🔄</div>
        <div style="font-size:18px; margin-top:8px;">Tính năng Trực tiếp KQXS đang phát triển...</div>
      </div>
    `;
  }
}
