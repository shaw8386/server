/* ==============================
 🧠 VER2 — QUẢN LÝ VÉ SỐ + GỬI LÊN SERVER
============================== */
const STATION = {
  bac: [
    { name: "Thái Bình", code: "thbi" },
    { name: "Hà Nội", code: "hnoi" },
    { name: "Quảng Ninh", code: "quni" },
    { name: "Bắc Ninh", code: "bani" },
    { name: "Hải Phòng", code: "haph" },
    { name: "Nam Định", code: "nadi" }
  ],
  trung: [
    { name: "Đà Nẵng", code: "dana" },
    { name: "Bình Định", code: "bidi" },
    { name: "Đắk Lắk", code: "dalak" },
    { name: "Đắk Nông", code: "dano" },
    { name: "Gia Lai", code: "gila" },
    { name: "Khánh Hòa", code: "khho" },
    { name: "Kon Tum", code: "kotu" },
    { name: "Ninh Thuận", code: "nith" },
    { name: "Phú Yên", code: "phye" },
    { name: "Quảng Bình", code: "qubi" },
    { name: "Quảng Nam", code: "quna" },
    { name: "Quảng Ngãi", code: "qung" },
    { name: "Quảng Trị", code: "qutr" },
    { name: "Thừa Thiên Huế", code: "thth" }
  ],
  nam: [
    { name: "An Giang", code: "angi" },
    { name: "Bạc Liêu", code: "bali" },
    { name: "Bến Tre", code: "bete" },
    { name: "Bình Dương", code: "bidu" },
    { name: "Bình Phước", code: "biph" },
    { name: "Cà Mau", code: "cama" },
    { name: "Cần Thơ", code: "cath" },
    { name: "Đà Lạt", code: "dalat" },
    { name: "Đồng Nai", code: "dona" },
    { name: "Đồng Tháp", code: "doth" },
    { name: "Hậu Giang", code: "hagi" },
    { name: "Kiên Giang", code: "kigi" },
    { name: "Long An", code: "loan" },
    { name: "Sóc Trăng", code: "sotr" },
    { name: "Tây Ninh", code: "tani" },
    { name: "Tiền Giang", code: "tigi" },
    { name: "TP. Hồ Chí Minh", code: "tphc" },
    { name: "Trà Vinh", code: "trvi" },
    { name: "Vĩnh Long", code: "vilo" },
    { name: "Vũng Tàu", code: "vuta" },
    { name: "Bạc Ninh", code: "bani" },
    { name: "Hải Phòng", code: "haph" },
    { name: "Nam Định", code: "nadi" },
    { name: "Quảng Ninh", code: "quni" },
    { name: "Thái Bình", code: "thbi" }
  ]
};

// =====================
// 🧩 LOGIC CHÍNH
// =====================

// Khóa lưu trong localStorage
const TICKET_KEY = "xs_tickets_v2";

// Helper DOM
function elt(id) { return document.getElementById(id); }

/* === Load / Save vé === */
function loadTickets() {
  try { return JSON.parse(localStorage.getItem(TICKET_KEY) || "[]"); }
  catch (e) { return []; }
}
function saveTickets(arr) {
  localStorage.setItem(TICKET_KEY, JSON.stringify(arr));
}

/* === Hiển thị danh sách vé === */
function renderSavedTickets() {
  const wrap = elt("savedTickets");
  const list = loadTickets();

  if (!list.length) {
    wrap.innerHTML = `<div style="color:#666;text-align:center">Chưa có vé nào.</div>`;
    return;
  }

  wrap.innerHTML = list
    .map((t, i) => {
      // icon theo trạng thái
      let icon = "";
      switch (t.status) {
        case "V": icon = "🏆"; break;      // trúng
        case "O": icon = "⏳"; break;      // đang chờ
        case "X": default: icon = "❌";    // trật
      }

      return `
        <div class="ticket-row">
          <span class="province">${t.label}</span>
          <span class="date">${t.drawDate}</span>
          <span class="numbers">${t.number}</span>
          <span class="status">${icon}</span>
          <button data-i="${i}" class="delTicket">Xóa</button>
        </div>
      `;
    })
    .join("");

  // gán sự kiện xóa
  wrap.querySelectorAll(".delTicket").forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.i);
      const arr = loadTickets();
      arr.splice(idx, 1);
      saveTickets(arr);
      renderSavedTickets();
    };
  });
}

/* === Fill dropdown danh sách đài === */
function populateTicketStations(regionKey) {
  const selectEl = elt("ticketStation");
  selectEl.innerHTML = "";

  const stations = STATION[regionKey];
  if (!stations?.length) {
    const opt = document.createElement("option");
    opt.textContent = "— Không có đài —";
    selectEl.appendChild(opt);
    return;
  }

  stations.forEach(st => {
    const opt = document.createElement("option");
    opt.value = st.code;
    opt.textContent = st.name;
    selectEl.appendChild(opt);
  });
}

/* === Khi chọn Miền === */
elt("ticketRegion").addEventListener("change", e => {
  populateTicketStations(e.target.value);
});

/* === Khi load trang === */
window.addEventListener("DOMContentLoaded", () => {
  const ticketInput = elt("ticketInput");

  if (ticketInput) {
    ticketInput.addEventListener("input", (e) => {
      let value = e.target.value.replace(/[^0-9]/g, "");
      if (value.length > 6) value = value.slice(0, 6);
      e.target.value = value;
    });
  }

  const regionSelect = elt("ticketRegion");
  populateTicketStations(regionSelect.value || "bac");
});

/* === Toast === */
function toastShow(text, ms = 3500) {
  const t = elt("toast");
  t.textContent = text;
  t.style.display = "block";
  clearTimeout(t._hid);
  t._hid = setTimeout(() => (t.style.display = "none"), ms);
}

function formatVN(dateStr) {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/* =========================================
   📤 LƯU VÉ & GỬI LÊN SERVER (ĐÃ THÊM AUTO CHECK)
========================================= */
elt("saveTicketBtn").addEventListener("click", async () => {
  const num = elt("ticketInput").value.trim();
  const region = elt("ticketRegion").value;
  const code = elt("ticketStation").value;
  const dateVal = elt("ticketDate").value;

  if (!num) return toastShow("Nhập số hợp lệ!");
  if (!dateVal) return toastShow("Chọn ngày vé!");

  const today = new Date();
  const buyDate = new Date(dateVal);

  const drawDate = formatVN(dateVal);


  const stationObj = (STATION[region] || []).find(x => x.code === code) || { name: code };
  const label =
    region === "bac" ? `${stationObj.name}` :
    region === "trung" ? `${stationObj.name}` :
    `${stationObj.name}`;

  const arr = loadTickets();
  const ticketObj = { number: num, code, region, label, drawDate, status: "O" };
  arr.push(ticketObj);
  saveTickets(arr);
  renderSavedTickets();

  toastShow("💾 Đã lưu vé!");

  // =============================
  // ⏰ GIỜ XỔ TỪNG MIỀN
  // =============================
  const DRAW_TIMES = {
    bac: { hour: 18, minute: 35 },
    trung: { hour: 17, minute: 35 },
    nam: { hour: 16, minute: 35 },
  };
  const drawTime = new Date();
  drawTime.setHours(DRAW_TIMES[region].hour, DRAW_TIMES[region].minute, 0, 0);


  // =====================================================
  // 1️⃣ VÉ CŨ — APP TỰ DÒ (KHÔNG GỬI LÊN SERVER)
  // =====================================================
  if (buyDate < new Date(today.toDateString())) {
    console.log("📌 Vé cũ → App tự dò, không gửi server");

    autoCheckClient(ticketObj, arr, num, region === "bac" ? "miba" : code, region);

    return;
  }


  // =====================================================
  // 2️⃣ VÉ HÔM NAY ĐÃ QUA GIỜ XỔ → APP TỰ DÒ
  // =====================================================
  if (buyDate.toDateString() === today.toDateString() && today > drawTime) {
    console.log("📌 Vé hôm nay nhưng đã qua giờ → App tự dò");

    autoCheckClient(ticketObj, arr, num, code, region);
    return;
  }


  // =====================================================
  // 3️⃣ VÉ TƯƠNG LAI HOẶC CHƯA ĐẾN GIỜ — GỬI LÊN SERVER
  // =====================================================
  try {
    const token = window.fcmToken || localStorage.getItem("fcm_token") || "unknown";

    const payload = {
      number: num,
      region,
      station: region === "bac" ? "miba" : code,
      label,
      buy_date: dateVal,
      token
    };

    console.log("📤 Gửi vé lên server:", payload);

    const res = await fetch("https://server-production-1cde.up.railway.app/api/save-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("📥 Server:", data);

    if (data.mode === "immediate") {
      ticketObj.status = data.result?.includes("Trúng") ? "V" : "X";
      saveTickets(arr);
      renderSavedTickets();
      toastShow("🏁 Đã dò ngay!");
    } else {
      ticketObj.status = "O";
      saveTickets(arr);
      renderSavedTickets();
      toastShow("⏳ Vé đã gửi lên server — chờ kết quả");
    }

  } catch (err) {
    console.error("❌ Lỗi khi gửi vé:", err);
    toastShow("❌ Lỗi kết nối server!");
  }
});

// ==============================
// 🔍 Auto Check Client Side
// ==============================
async function autoCheckClient(ticketObj, arr, number, station, region) {
  toastShow("🔍 Đang dò kết quả...");

  try {
    const apiUrl = `https://server-production-1cde.up.railway.app/api/front/open/lottery/history/list/game?limitNum=100&gameCode=${region === "bac" ? "miba" : station}`;
    const res = await fetch(apiUrl);
    const text = await res.text();
    console.log("apiUrl dduwocj dungf la : ", apiUrl);
    let data;
    try { data = JSON.parse(text); } catch {}

    // ⭐ SỬA Ở ĐÂY
    const parsed = parseLotteryApiResponseFE(
        data,
        region,
        ticketObj.drawDate // "20/11/2025"
    );
    const resultText = checkResult(number, parsed.numbers, region);

    // cập nhật icon
    ticketObj.status = resultText.includes("Trúng") ? "V" : "X";
    saveTickets(arr);
    renderSavedTickets();

    toastShow(resultText);

  } catch (err) {
    console.error("❌ Lỗi auto check:", err);
    toastShow("❌ Không thể dò kết quả!");
  }
}

function checkResult(ticketNumber, results, region) {
  const n = ticketNumber.trim();

  const match = (arr, digits) => {
    const user = n.slice(-digits);
    return arr.some(v => String(v).trim().slice(-digits) === user);
  };

  if (!results) return "⚠️ Không lấy được kết quả xổ số.";

  // ============================ MIỀN BẮC ============================
  if (region === "bac") {

    if (results["ĐB"] && match(results["ĐB"], 5))
      return "🎯 Trúng Giải Đặc Biệt!";

    if (results["G1"] && match(results["G1"], 5))
      return "🥇 Trúng Giải Nhất!";

    if (results["G2"] && match(results["G2"], 5))
      return "🥈 Trúng Giải Nhì!";

    if (results["G3"] && match(results["G3"], 5))
      return "🥉 Trúng Giải Ba!";

    if (results["G4"] && match(results["G4"], 4))
      return "🎉 Trúng Giải 4!";

    if (results["G5"] && match(results["G5"], 4))
      return "🎉 Trúng Giải 5!";

    if (results["G6"] && match(results["G6"], 3))
      return "🎉 Trúng Giải 6!";

    if (results["G7"] && match(results["G7"], 2))
      return "🎉 Trúng Giải 7!";

    return "❌ Không trúng thưởng.";
  }


  // ============================ MIỀN TRUNG / NAM ============================
  if (results["ĐB"] && match(results["ĐB"], 6))
    return "🎯 Trúng Giải Đặc Biệt!";

  if (results["G1"] && match(results["G1"], 5))
    return "🥇 Trúng Giải Nhất!";

  if (results["G2"] && match(results["G2"], 5))
    return "🥈 Trúng Giải Nhì!";

  if (results["G3"] && match(results["G3"], 5))
    return "🥉 Trúng Giải Ba!";

  if (results["G4"] && match(results["G4"], 5))
    return "🎉 Trúng Giải 4!";

  if (results["G5"] && match(results["G5"], 4))
    return "🎉 Trúng Giải 5!";

  if (results["G6"] && match(results["G6"], 4))
    return "🎉 Trúng Giải 6!";

  if (results["G7"] && match(results["G7"], 3))
    return "🎉 Trúng Giải 7!";

  if (results["G8"] && match(results["G8"], 2))
    return "🎉 Trúng Giải 8!";

  return "❌ Không trúng thưởng.";
}

// ==============================
// 📌 PARSE KẾT QUẢ THEO NGÀY USER CHỌN
// ==============================
function parseLotteryApiResponseFE(data, region, ticketDateStr) {
  const out = { date: null, numbers: {} };
  if (!data || !data.t || !data.t.issueList) return out;

  try {
    // Convert "20/11/2025" (ticketObj.drawDate) → "20/11/2025"
    // ticketDateStr có thể là "2025-11-20" hoặc "20/11/2025"
    let targetDate = ticketDateStr;

    // Nếu dạng yyyy-mm-dd → chuyển sang dd/mm/yyyy
    if (ticketDateStr.includes("-")) {
      const [y, m, d] = ticketDateStr.split("-");
      targetDate = `${d}/${m}/${y}`;
    }

    // 🔍 TÌM KỲ ĐÚNG NGÀY
    let issue = data.t.issueList.find(i => i.turnNum === targetDate);

    // ❗ Nếu không tìm thấy — fallback: lấy issue mới nhất
    if (!issue) {
      console.warn("⚠ Không tìm thấy đúng ngày → fallback issue mới nhất");
      issue = data.t.issueList[0];
    }

    out.date = issue.openTime;

    const detail = JSON.parse(issue.detail); // Mảng string
    let prizeNames;

    // ================= MIỀN BẮC =================
    if (region === "bac") {
      prizeNames = ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];

      detail.forEach((raw, idx) => {
        const prize = prizeNames[idx];
        out.numbers[prize] = raw.split(",").map(v => v.trim());
      });

      return out;
    }

    // ================= MIỀN TRUNG / NAM =================
    prizeNames = ["ĐB", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];

    detail.forEach((raw, idx) => {
      const prize = prizeNames[idx];
      if (!prize) return;
      out.numbers[prize] = raw.split(",").map(v => v.trim());
    });

  } catch (err) {
    console.error("❌ parse FE error:", err);
  }

  return out;
}



/* === Set ngày mặc định hôm nay === */
const ticketDate = elt("ticketDate");
ticketDate.value = new Date().toISOString().split("T")[0];
ticketDate.setAttribute("value", ticketDate.value);

/* === Khởi tạo === */
renderSavedTickets();
