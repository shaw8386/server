// ====================== CONFIG ======================
const API_BASE = ""; // cùng domain Railway => để rỗng
const LS_TOKEN = "auth_token";
const LS_USER  = "auth_user";

// ⚠️ đổi thành bot username của bạn (KHÔNG có @)
const TG_BOT_USERNAME = "gi8_check_bot";

// ====================== STORAGE ======================
function setSession(token, user) {
  localStorage.setItem(LS_TOKEN, token);
  localStorage.setItem(LS_USER, JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
  localStorage.removeItem("reg_token");
}
function getToken() {
  return localStorage.getItem(LS_TOKEN) || "";
}
function getUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || "null"); } catch { return null; }
}

// ====================== UI HELPERS ======================
function $(id) { return document.getElementById(id); }

function showMsg(text) {
  const el = $("authMsg");
  if (!el) return;
  el.style.display = "block";
  el.textContent = text;
}
function hideMsg() {
  const el = $("authMsg");
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}

function showTelegramPanel(show) {
  const p = $("tgWidgetPanel");
  if (!p) return;
  p.style.display = show ? "block" : "none";
  if (show) p.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showSetPwPanel(show) {
  const p = $("setPwPanel");
  if (!p) return;
  p.style.display = show ? "block" : "none";
  if (show) p.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTopbarAuth() {
  const user = getUser();
  const icon = document.getElementById("authIcon");
  const avatar = document.getElementById("authAvatar");
  const badge = document.getElementById("authBadge");

  if (!icon || !avatar || !badge) return;

  if (!user) {
    // Logged out
    icon.textContent = "🔐";
    avatar.style.display = "none";
    badge.style.display = "none";
    badge.textContent = "0";
    return;
  }

  // Logged in
  icon.textContent = "👤";

  // Badge points
  const pts = Number(user.points ?? 0);
  badge.textContent = pts > 99 ? "99+" : String(pts);
  badge.style.display = "flex";

  // Avatar (nếu có)
  // Nếu bạn muốn lưu photo_url vào DB/LS thì thêm field photo_url khi register.
  const photoUrl = user.photo_url || user.photo || user.avatar_url;

  if (photoUrl) {
    avatar.style.backgroundImage = `url("${photoUrl}")`;
    avatar.textContent = "";
    avatar.style.display = "block";
  } else {
    // fallback chữ cái
    const name = (user.full_name || "").trim();
    const letter = name ? name[0].toUpperCase() : "U";
    avatar.style.backgroundImage = "";
    avatar.textContent = letter;
    avatar.style.display = "flex";
    avatar.style.alignItems = "center";
    avatar.style.justifyContent = "center";
    avatar.style.fontWeight = "900";
    avatar.style.color = "#111";
    avatar.style.fontSize = "13px";
  }
}

// ====================== RENDER ======================
function renderAuthUI() {
  const user = getUser();
  const out = $("authStateLoggedOut");
  const inn = $("authStateLoggedIn");

  if (!out || !inn) return;

  if (!user) {
    out.style.display = "block";
    inn.style.display = "none";
    return;
  }

  out.style.display = "none";
  inn.style.display = "block";

  $("uTgId").innerText = user.telegram_id ?? "--";
  $("uFullName").innerText = user.full_name ?? "--";
  $("uPoints").innerText = user.points ?? 0;

  const claimed = !!user.claimed_today;
  $("uClaimedToday").innerText = claimed ? "✅ Đã nhận" : "❌ Chưa nhận";

  const btnClaim = $("btnClaimDaily");
  if (btnClaim) {
    btnClaim.disabled = claimed;
    btnClaim.style.opacity = claimed ? "0.6" : "1";
  }
  renderTopbarAuth();
}

// ====================== API: REFRESH ME ======================
async function refreshMe() {
  const token = getToken();
  if (!token) return;

  try {
    const resp = await fetch(API_BASE + "/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await resp.json();

    if (data?.success && data.user) {
      setSession(token, data.user);
    } else {
      clearSession();
    }
  } catch {
    // nếu lỗi mạng, giữ session cũ (không clear) để user không bị logout oan
  }
}

// ====================== LOGIN username+password ======================
async function doLogin() {
  hideMsg();

  const telegram_id = ($("loginUsername")?.value || "").trim();
  const password = ($("loginPassword")?.value || "").trim();

  if (!telegram_id || !password) {
    showMsg("Vui lòng nhập Username (Telegram ID) và Password");
    return;
  }

  try {
    const resp = await fetch(API_BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id, password }),
    });
    const data = await resp.json();

    if (!data.success) {
      if (data.code === "NOT_FOUND") {
        showMsg("Chưa có tài khoản. Vui lòng đăng ký bằng Telegram.");
        showTelegramPanel(true);
        return;
      }
      if (data.code === "WRONG_PASSWORD") {
        showMsg("Sai mật khẩu");
        return;
      }
      if (data.code === "NO_PASSWORD") {
        showMsg("Tài khoản chưa có mật khẩu. Vui lòng đăng ký bằng Telegram.");
        showTelegramPanel(true);
        return;
      }
      showMsg(data.message || "Đăng nhập thất bại");
      return;
    }

    setSession(data.token, data.user);
    renderAuthUI();
    window.switchPage?.("profile");
  } catch {
    showMsg("❌ Lỗi kết nối server");
  }
}

// ====================== TELEGRAM REGISTER (Widget) ======================
function mountTelegramWidget() {
  const wrap = $("tgWidgetWrap");
  if (!wrap) return;

  wrap.innerHTML = "";

  window.onTelegramAuth = async (tgUser) => {
    hideMsg();

    try {
      const resp = await fetch(API_BASE + "/auth/telegram-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tgUser),
      });
      const data = await resp.json();

      if (!data.success) {
        if (data.code === "EXISTS") {
          showMsg("Tài khoản đã tồn tại. Hãy đăng nhập bằng Username + Password.");
          showTelegramPanel(false);
          return;
        }
        showMsg(data.message || "Đăng ký Telegram thất bại");
        return;
      }

      // lưu reg_token để set password
      localStorage.setItem("reg_token", data.reg_token || "");
      showMsg("✅ Đăng ký Telegram OK. Vui lòng đặt mật khẩu.");
      showSetPwPanel(true);

    } catch {
      showMsg("❌ Lỗi kết nối server");
    }
  };

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://telegram.org/js/telegram-widget.js?22";
  s.setAttribute("data-telegram-login", TG_BOT_USERNAME);
  s.setAttribute("data-size", "large");
  s.setAttribute("data-userpic", "false");
  s.setAttribute("data-request-access", "write");
  s.setAttribute("data-onauth", "onTelegramAuth(user)");
  wrap.appendChild(s);
}

// ====================== SET PASSWORD AFTER REGISTER ======================
async function doSetPassword() {
  hideMsg();

  const password = ($("setPwInput")?.value || "").trim();
  if (!password || password.length < 4) {
    showMsg("Password tối thiểu 4 ký tự");
    return;
  }

  const reg_token = localStorage.getItem("reg_token") || "";
  if (!reg_token) {
    showMsg("Thiếu reg_token. Vui lòng đăng ký Telegram lại.");
    showTelegramPanel(true);
    return;
  }

  try {
    const resp = await fetch(API_BASE + "/auth/register-set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reg_token, password }),
    });
    const data = await resp.json();

    if (!data.success) {
      showMsg(data.message || "Lưu mật khẩu thất bại");
      return;
    }

    // đăng nhập luôn
    setSession(data.token, data.user);
    localStorage.removeItem("reg_token");

    showSetPwPanel(false);
    showTelegramPanel(false);

    renderAuthUI();
    window.switchPage?.("profile");

  } catch {
    showMsg("❌ Lỗi kết nối server");
  }
}

// ====================== CLAIM DAILY POINT ======================
async function claimDailyPoint() {
  hideMsg();

  const token = getToken();
  if (!token) {
    showMsg("Bạn chưa đăng nhập");
    return;
  }

  try {
    const resp = await fetch(API_BASE + "/app/points/claim-daily", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    const data = await resp.json();

    // cập nhật user nếu server trả về
    if (data.user) {
      setSession(token, data.user);
      renderAuthUI();
    }

    if (!data.success) {
      showMsg(data.message || "Không nhận điểm được");
      return;
    }

    showMsg(data.message || "✅ Nhận +1 điểm thành công");
  } catch {
    showMsg("❌ Lỗi kết nối server");
  }
}

// ====================== LOGOUT ======================
function doLogout() {
  clearSession();
  renderAuthUI();
  hideMsg();
  showTelegramPanel(false);
  showSetPwPanel(false);
}

// ====================== INIT ======================
document.addEventListener("DOMContentLoaded", async () => {
  mountTelegramWidget();

  // refresh me nếu đã login từ trước
  await refreshMe();
  renderAuthUI();

  $("btnLogin")?.addEventListener("click", doLogin);
  $("btnTgRegister")?.addEventListener("click", () => {
    hideMsg();
    showTelegramPanel(true);
  });
  $("btnSetPwSubmit")?.addEventListener("click", doSetPassword);
  $("btnClaimDaily")?.addEventListener("click", claimDailyPoint);
  $("btnLogout")?.addEventListener("click", doLogout);

  // enter để login nhanh
  $("loginPassword")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const authBtn = document.getElementById("authBtn");
  if (authBtn) {
    authBtn.addEventListener("click", () => {
      if (typeof switchPage === "function") {
        switchPage("profile");
      } else {
        console.warn("⚠️ switchPage chưa được load");
      }
    });
  }
});
