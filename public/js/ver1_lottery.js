const API = 'https://server-production-1cde.up.railway.app/api/front/open/lottery/history/list/game?limitNum=200&gameCode=${currentStation}';
let issues = [], currentIndex = 0, mode = 'all';
const el = id => document.getElementById(id);

/* ==============================
 🧠 VER1 — KẾT QUẢ XỔ SỐ 
============================== */
/* --- Lấy tên đài theo ngày --- */
function getStationName(dateStr) {
  const [d,m,y] = dateStr.split('/').map(x=>parseInt(x));
  const dt = new Date(`${y}-${m}-${d}`);
  const map = {
    0:"Thái Bình",1:"Hà Nội",2:"Quảng Ninh",
    3:"Bắc Ninh",4:"Hà Nội",5:"Hải Phòng",6:"Nam Định"
  };
  return map[dt.getDay()] || "Hà Nội";
}

/* --- Load dữ liệu từ API --- */
async function loadData(){
  const res = await fetch(API);
  const json = await res.json();
  issues = json.t.issueList || [];
  render(currentIndex);
}

function render(idx) {
  const it = issues[idx];
  if (!it) return;

  el("dateLabel").textContent = it.turnNum;

  // Hiển thị tiêu đề: XSMB / XSMT / XSMN
  let regionLabel = "";
  if (currentRegion === "bac") regionLabel = `XSMB - ${getStationName(it.turnNum)}`;
  else if (currentRegion === "trung") regionLabel = `XSMT - ${stationSelect.selectedOptions[0].textContent}`;
  else regionLabel = `XSMN - ${stationSelect.selectedOptions[0].textContent}`;
  el("regionLabel").textContent = regionLabel;

  const groups = JSON.parse(it.detail);

  const renderGroup = (id, arr) => {
    const div = el(id);
    div.innerHTML = "";
    arr.forEach((x) => (div.innerHTML += `<div class="numb-pill">${displayNum(x)}</div>`));
  };

  // reset hiển thị
  el("g8-row").style.display = "none";

  // 🧩 Trường hợp miền Nam / Trung có 9 phần tử (G8)
  if (groups.length === 9) {
    el("g8-row").style.display = "flex";

    // Đặc biệt ở đầu, giải 8 ở cuối
    el("dbNumber").textContent = displayNum(groups[0]); // ĐB
    el("g1Number").textContent = displayNum(groups[1]); // G1
    renderGroup("g2", groups[2].split(",")); // G2
    renderGroup("g3", groups[3].split(",")); // G3
    renderGroup("g4", groups[4].split(",")); // G4
    renderGroup("g5", groups[5].split(",")); // G5
    renderGroup("g6", groups[6].split(",")); // G6
    renderGroup("g7", groups[7].split(",")); // G7
    renderGroup("g8", groups[8].split(",")); // G8
  }
  // 🧩 Miền Bắc (8 giải: ĐB→G7)
  else {
    el("dbNumber").textContent = displayNum(groups[0]);
    el("g1Number").textContent = displayNum(groups[1]);
    renderGroup("g2", groups[2].split(","));
    renderGroup("g3", groups[3].split(","));
    renderGroup("g4", groups[4].split(","));
    renderGroup("g5", groups[5].split(","));
    renderGroup("g6", groups[6].split(","));
    renderGroup("g7", groups[7].split(","));
  }

  // Lô tô (từ tất cả số)
  renderLoto(groups.flatMap((g) => g.split(",")));

}


/* --- Hiển thị theo chế độ All / 2 số / 3 số --- */
function displayNum(n){
  n=n.trim();
  if(mode==='2')return n.slice(-2);
  if(mode==='3')return n.slice(-3);
  return n;
}

/* --- Tính và render Lô tô đầu – đuôi --- */
function renderLoto(nums){
  const lotoLeft=el('loto-left'),lotoRight=el('loto-right');
  const two=nums.map(x=>x.slice(-2));
  const head={};for(let i=0;i<=9;i++)head[i]=[];
  two.forEach(x=>head[x[0]].push(x));
  const mk=(from,to,container)=>{
    container.innerHTML='';
    for(let i=from;i<=to;i++){
      const vals=head[i].length?head[i].join(' '):'--';
      container.innerHTML+=`<div class="loto-row"><div class="head">${i}</div><div>${vals}</div></div>`;
    }
  };
  mk(0,4,lotoLeft); mk(5,9,lotoRight);
}

/* --- Giọng đọc tiếng Việt --- */
async function speak(){
  const it = issues[currentIndex];
  const groups = JSON.parse(it.detail);
  const region = getStationName(it.turnNum);

  const msgText = `
    Kết quả Xổ số Miền Bắc, đài ${region}, ngày ${it.turnNum}.
    Giải đặc biệt: ${spell(groups[0])}.
    Giải nhất: ${spell(groups[1])}.
    Giải nhì: ${spell(groups[2])}.
    Giải ba: ${spell(groups[3])}.
    Giải bốn: ${spell(groups[4])}.
    Giải năm: ${spell(groups[5])}.
    Giải sáu: ${spell(groups[6])}.
    Giải bảy: ${spell(groups[7])}.
  `.replace(/\s+/g,' ').trim();

  const u = new SpeechSynthesisUtterance(msgText);
  u.lang = 'vi-VN';
  const voices = await new Promise(r=>{
    let vs=speechSynthesis.getVoices();
    if(vs.length)r(vs);
    else speechSynthesis.onvoiceschanged=()=>r(speechSynthesis.getVoices());
  });
  const viVoice = voices.find(v=>v.lang.toLowerCase().includes('vi'));
  if(viVoice)u.voice=viVoice;
  u.rate=1;u.pitch=1;u.volume=1;
  speechSynthesis.cancel();speechSynthesis.speak(u);
}

/* --- Đọc số thành chữ --- */
function spell(str){
  return str.trim().split('').map(ch=>{
    const map={'0':'không','1':'một','2':'hai','3':'ba','4':'bốn','5':'năm','6':'sáu','7':'bảy','8':'tám','9':'chín'};
    return map[ch]||ch;
  }).join(' ');
}

/* --- Xử lý chế độ hiển thị --- */
el('mode-all').onclick=()=>{mode='all';updateMode();}
el('mode-2').onclick=()=>{mode='2';updateMode();}
el('mode-3').onclick=()=>{mode='3';updateMode();}
function updateMode(){
  ['all','2','3'].forEach(m=>el('mode-'+m).classList.toggle('active',m===mode));
  render(currentIndex);
}
el('speakBtn').onclick=speak;

/* --- Nút Trước / Sau --- */
el('prevBtn').onclick=()=>{if(currentIndex<issues.length-1){currentIndex++;render(currentIndex);}};
el('nextBtn').onclick=()=>{if(currentIndex>0){currentIndex--;render(currentIndex);}};

/* --- Lịch mini --- */
const calendarBtn=el('calendarBtn'),calendarPopup=el('calendarPopup');
const monthLabel=el('monthLabel'),calendarGrid=el('calendarGrid');
const prevMonthBtn=el('prevMonth'),nextMonthBtn=el('nextMonth');
let currentMonth=new Date().getMonth(),currentYear=new Date().getFullYear();

function renderCalendar(month,year){
  const today=new Date();
  const firstDay=new Date(year,month).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  monthLabel.textContent=`Tháng ${month+1} / ${year}`;
  calendarGrid.innerHTML='';

  const dayNames=['CN','T2','T3','T4','T5','T6','T7'];
  dayNames.forEach(d=>{
    const el=document.createElement('div');
    el.innerHTML=`<b>${d}</b>`;
    el.style.color='#c62828';
    calendarGrid.appendChild(el);
  });

  for(let i=0;i<firstDay;i++){
    const blank=document.createElement('div');
    blank.classList.add('inactive');
    calendarGrid.appendChild(blank);
  }

  for(let day=1;day<=daysInMonth;day++){
    const dateEl=document.createElement('div');
    dateEl.textContent=day;
    const isToday=day===today.getDate()&&month===today.getMonth()&&year===today.getFullYear();
    if(isToday)dateEl.classList.add('today');
    dateEl.addEventListener('click', () => {
      const formatted = `${String(day).padStart(2,'0')}/${String(month+1).padStart(2,'0')}/${year}`;

      // luôn cập nhật biểu thị ngày
      el("dateLabel").textContent = formatted;

      const toDate = str => {
        const p = str.split(/[\/\-]/).map(Number);
        return new Date(p[2], p[1] - 1, p[0]).getTime();
      };

      const target = toDate(formatted);
      const foundIndex = issues.findIndex(i => toDate(i.turnNum) === target);

      if (foundIndex !== -1) {
        currentIndex = foundIndex;
        render(currentIndex);
      } else {
        el("regionLabel").textContent = "Đang chờ cập nhật...!";
        el("dbNumber").textContent = "--";
        el("g1Number").textContent = "--";
        ["g2","g3","g4","g5","g6","g7","g8"].forEach(id => {
          const div = el(id);
          if (div) div.innerHTML = "";
        });
        el("g8-row").style.display = "none";
      }

      calendarPopup.style.display = 'none';
    });


    calendarGrid.appendChild(dateEl);
  }
}

/* --- Bật/tắt popup lịch --- */
calendarBtn.addEventListener('click',()=>{
  calendarPopup.style.display = calendarPopup.style.display==='block'?'none':'block';
  renderCalendar(currentMonth,currentYear);
});
prevMonthBtn.addEventListener('click',()=>{
  currentMonth--; if(currentMonth<0){currentMonth=11;currentYear--;}
  renderCalendar(currentMonth,currentYear);
});
nextMonthBtn.addEventListener('click',()=>{
  currentMonth++; if(currentMonth>11){currentMonth=0;currentYear++;}
  renderCalendar(currentMonth,currentYear);
});
document.addEventListener('click',e=>{
  if(!calendarPopup.contains(e.target)&&!calendarBtn.contains(e.target)){
    calendarPopup.style.display='none';
  }
});

// Danh sách code từng đài
const STATIONS = {
  bac: [
    { name: "Miền Bắc", code: "miba" }
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

let currentRegion = "bac";
let currentStation = "miba"; // mặc định Miền Bắc

const regionSelect = document.getElementById("regionSelect");
const stationSelect = document.getElementById("stationSelect");

function populateStations(regionKey) {
  const stations = STATIONS[regionKey] || [];
  stationSelect.innerHTML = "";
  stations.forEach(st => {
    const opt = document.createElement("option");
    opt.value = st.code;
    opt.textContent = st.name;
    stationSelect.appendChild(opt);
  });
  currentStation = stations[0]?.code || "miba";
}

regionSelect.addEventListener("change", e => {
  currentRegion = e.target.value;
  populateStations(currentRegion);
  loadData(); // tải lại API
});

stationSelect.addEventListener("change", e => {
  currentStation = e.target.value;
  loadData();
});

/* --- Override lại loadData để dùng code đài --- */
async function loadData() {
  const API_URL = `https://server-production-1cde.up.railway.app/api/front/open/lottery/history/list/game?limitNum=200&gameCode=${currentStation}`;
  try {
    const res = await fetch(API_URL);
    const json = await res.json();
    issues = json.t?.issueList || [];
    if (issues.length === 0) {
      el('regionLabel').textContent = "Đang chờ cập nhật...!";
      el("mainResults").innerHTML = `
        <div style="padding:20px;text-align:center;color:#777;font-size:16px;">
          ⏳ Chưa có dữ liệu cho đài <b>${currentStation}</b>. Đang chờ cập nhật...
        </div>`;
      return;
    }
    render(currentIndex);
  } catch (err) {
    console.error("❌ Lỗi tải API:", err);
    el('regionLabel').textContent = "Lỗi tải dữ liệu...";
  }
}

/* --- Khởi tạo --- */
populateStations(currentRegion);

/* --- 🧠 AUTO LOAD KHI VỪA MỞ APP --- */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    // Mặc định load Miền Bắc
    currentRegion = "bac";
    currentStation = "miba";

    // Cập nhật dropdown UI
    regionSelect.value = "bac";
    populateStations("bac");
    stationSelect.value = "miba";

    // Gọi API lấy kết quả Miền Bắc mới nhất
    const apiUrl = `https://server-production-1cde.up.railway.app/api/front/open/lottery/history/list/game?limitNum=200&gameCode=miba`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    const list = data.t?.issueList || [];
    if (list.length === 0) {
      el("regionLabel").textContent = "⚠️ Chưa có kết quả Miền Bắc hôm nay.";
      return;
    }

    // Lấy issue có status=2 (đã xổ) hoặc issue mới nhất
    const idx = list.findIndex(i => i.status === 2);
    issues = list;
    currentIndex = idx >= 0 ? idx : 0;

    render(currentIndex);
    el("regionLabel").textContent = "XSMB - Miền Bắc";
    console.log("✅ Auto load kết quả XSMB thành công!");
  } catch (err) {
    console.error("❌ Auto load XSMB lỗi:", err);
    el("regionLabel").textContent = "⚠️ Không tải được kết quả XSMB.";
  }
});
