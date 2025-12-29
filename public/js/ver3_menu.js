// ===============================
// 📋 MENU ĐIỀU HƯỚNG ĐA TRANG
// ===============================
(() => {
  const menuBtn = document.getElementById("menuBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarItems = document.querySelectorAll(".sidebar-item");
  const pages = document.querySelectorAll(".page");
  const pageTitle = document.getElementById("pageTitle");
  const calendarBtn = document.getElementById("calendarBtn");

  // Mặc định: Trang chủ hiển thị
  switchPage("home");

  // Bấm ☰ để mở/đóng menu
  menuBtn.onclick = () => sidebar.classList.toggle("active");

  /* ====== 2️⃣ CLICK RA NGOÀI => ĐÓNG MENU ====== */
  document.addEventListener("click", (e) => {
    // Nếu click KHÔNG nằm trong sidebar & KHÔNG phải nút ☰ thì ẩn menu
    if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
      sidebar.classList.remove("active");
    }
  });
  
  // Khi chọn menu
  sidebarItems.forEach(item => {
    item.addEventListener("click", () => {
      const target = item.dataset.page;
      switchPage(target);
      sidebar.classList.remove("active");
    });
  });

  function switchPage(pageName) {
    // Ẩn tất cả
    pages.forEach(p => p.classList.remove("active"));

    // Hiển thị trang được chọn
    const activePage = document.getElementById(`page-${pageName}`);
    if (activePage) activePage.classList.add("active");

    // Cập nhật tiêu đề
    if (pageName === "home") {
      pageTitle.textContent = "Trang Chủ";
    } else if (pageName === "lottery") {
      pageTitle.textContent = "Kết Quả Xổ Số";
    } else if (pageName === "tickets") {
      pageTitle.textContent = "Tra Cứu KQXS";
    } else if (pageName === "lives") {
      pageTitle.textContent = "Trực Tiếp KQXS";

      // 👇 Gọi animation từ ver4_live.js
      if (typeof startLiveAnimation === "function") {
        startLiveAnimation();
      } else {
        console.warn("⚠ startLiveAnimation() chưa được load!");
      }
    }

    // 📅 Chỉ hiện ở trang kết quả, tắt ở trang live
    calendarBtn.style.display = pageName === "lottery" ? "flex" : "none";
  }
  window.switchPage = switchPage;
})();
