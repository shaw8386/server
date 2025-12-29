const API_BASE = ""; // chạy cùng domain railway
const LS_TOKEN = "auth_token";
const LS_USER  = "auth_user";

function setSession(token, user) {
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_USER, JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
}
function getToken() {
  return localStorage.getItem(LS_TOKEN) || "";
}
function getUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || "null"); } catch { return null; }
}

function showTelegramPanel(show) {
  const p = document.getElementById("tgWidgetPanel");
  if (p) p.style.display = show ? "block" : "none";
}

function showPwPanel(show) {
  const p = document.getElementById("pwPanel");
  if (p) p.style.display = show ? "block" : "none";
}

function renderAuthUI() {
  const user = getUser();
  const out = document.getElementById("authStateLoggedOut");
  const inn = document.getElementById("authStateLoggedIn");

  if (!user) {
    out.style.display = "block";
    inn.style.display = "none";
    return;
  }
  out.style.display = "none";
  inn.style.display = "block";

  document.getElementById("uTgId").innerText = user.telegram_id;
  document.getElementById("uFullName").innerText = user.full_name || "--";
  document.getElementById("uPoints").innerText = user.points ?? 0;
}

// gắn widget telegram
function mountTelegramWidget() {
  const wrap = document.getElementById("tgWidgetWrap");
  if (!wrap) return;
  wrap.innerHTML = "";

  window.onTelegramAuth = async (tgUser) => {
    // 1) gửi telegram data lên server
    const resp = await fetch(API_BASE + "/auth/telegram", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(tgUser)
    });
    const data = await resp.json();

    if (!data.success) {
      alert(data.message || "Telegram login thất bại");
      return;
    }

    // data.status: NEED_SET_PASSWORD / NEED_PASSWORD / OK
    window.__pendingTg = { telegram_id: data.telegram_id }; // lưu tạm để login pass

    if (data.status === "NEED_SET_PASSWORD") {
      showPwPanel(true);
      document.getElementById("pwInput").value = "";
      alert("✅ Đăng ký lần đầu: hãy đặt mật khẩu");
      return;
    }

    if (data.status === "NEED_PASSWORD") {
      showPwPanel(true);
      document.getElementById("pwInput").value = "";
      alert("🔒 Tài khoản đã có: nhập mật khẩu để đăng nhập");
      return;
    }

    // OK trả token + user luôn
    setSession(data.token, data.user);
    showPwPanel(false);
    renderAuthUI();
    window.switchPage?.("profile");
  };

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://telegram.org/js/telegram-widget.js?22";
  s.setAttribute("data-telegram-login", "gi8_check_bot"); // đổi bot username
  s.setAttribute("data-size", "large");
  s.setAttribute("data-userpic", "false");
  s.setAttribute("data-request-access", "write");
  s.setAttribute("data-onauth", "onTelegramAuth(user)");
  wrap.appendChild(s);
}

async function submitPassword() {
  const pw = document.getElementById("pwInput").value || "";
  if (pw.length < 4) return alert("Mật khẩu tối thiểu 4 ký tự");

  const pending = window.__pendingTg;
  if (!pending?.telegram_id) return alert("Thiếu telegram_id, hãy login telegram lại");

  // gọi server: nếu user chưa có pass => set-password; nếu có pass => login-password
  // server sẽ tự quyết dựa vào DB

  const resp = await fetch(API_BASE + "/auth/password-flow", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ telegram_id: pending.telegram_id, password: pw })
  });

  const data = await resp.json();
  if (!data.success) return alert(data.message || "Sai mật khẩu");

  setSession(data.token, data.user);
  showPwPanel(false);
  renderAuthUI();
  window.switchPage?.("profile");
}

document.addEventListener("DOMContentLoaded", () => {
  mountTelegramWidget();
  renderAuthUI();

  document.getElementById("btnTgRegister")?.addEventListener("click", () => {
    showTelegramPanel(true);
  });
  document.getElementById("btnTgLogin")?.addEventListener("click", () => {
    showTelegramPanel(true);
  });
  document.getElementById("btnPwSubmit")?.addEventListener("click", submitPassword);

  document.getElementById("btnLogout")?.addEventListener("click", () => {
    clearSession();
    renderAuthUI();
  });
});
