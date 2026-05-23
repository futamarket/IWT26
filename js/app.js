// ── CONFIG ──────────────────────────────────────────────────────────────────
const EXAM_DURATION = 100 * 60; // 100 minutes in seconds
const ADMIN_PASSWORD = "IWTpassword";
const STORAGE_KEY = "iwt_exam_results";
const DRAFT_KEY = "iwt_exam_draft";

// Google Apps Script Web App URL — paste yours here after setup
let SUBMIT_URL = "https://script.google.com/macros/s/AKfycbxdxjzNYI2RlrheqU9DN-ynnPBdPIfT1q0Ywio7nuddtPq2_Obcg2EziLd4xgXK0Ffz/exec"; // e.g. "https://script.google.com/macros/s/YOUR_ID/exec"
const DRAFT_KEY = "iwt_exam_draft";

function saveDraft() {
  if (!state.examStarted || state.submitted) return;
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
    student: state.student, currentSection: state.currentSection,
    answers: state.answers, timeLeft: state.timeLeft,
  }));
}
function loadDraft() {
  try { const r = sessionStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function clearDraft() { sessionStorage.removeItem(DRAFT_KEY); }

// ── STATE ────────────────────────────────────────────────────────────────────
let state = {
  student: { name: "", matric: "", level: "", gender: "" },
  sections: ["wtc101", "wtc102", "wtc103", "wtc104", "wtc105"],
  currentSection: 0,
  answers: { wtc101: {}, wtc102: {}, wtc103: {}, wtc104: {}, wtc105: {} },
  timerInterval: null,
  timeLeft: EXAM_DURATION,
  submitted: false,
};

// ── DOM HELPERS ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); $(id).classList.add("active"); };

// ── LANDING ───────────────────────────────────────────────────────────────────
function startExam() {
  const name = $("inp-name").value.trim();
  const matric = $("inp-matric").value.trim();
  const level = $("inp-level").value;
  const gender = $("inp-gender").value;

  if (!name || !matric || !level || !gender) {
    showError("Please fill in all fields before starting.");
    return;
  }

  state.student = { name, matric, level, gender };
  state.currentSection = 0;
  state.answers = { wtc101: {}, wtc102: {}, wtc103: {}, wtc104: {}, wtc105: {} };
  state.timeLeft = EXAM_DURATION;
  state.submitted = false;

  show("screen-exam");
  renderSection();
  startTimer();
}

function showError(msg) {
  const el = $("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

// ── TIMER ────────────────────────────────────────────────────────────────────
function startTimer() {
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    updateTimerDisplay();
    if (state.timeLeft % 15 === 0) saveDraft();
    if (state.timeLeft <= 0) {
      clearInterval(state.timerInterval);
      autoSubmit();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(state.timeLeft / 60);
  const s = state.timeLeft % 60;
  const text = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  const el = $("timer-display");
  el.textContent = text;

  const box = $("timer-box");
  box.classList.remove("warning", "danger");
  if (state.timeLeft <= 300) box.classList.add("danger");
  else if (state.timeLeft <= 600) box.classList.add("warning");
}

// ── RENDER SECTION ────────────────────────────────────────────────────────────
function renderSection() {
  const secKey = state.sections[state.currentSection];
  const sec = QUESTION_BANK[secKey];
  const answers = state.answers[secKey];

  // Update section info
  $("section-title").textContent = `${sec.title}: ${sec.subject}`;
  $("section-subtitle").textContent = `Section ${state.currentSection + 1} of 5 · 40 Questions`;

  // Update tabs
  document.querySelectorAll(".tab-btn").forEach((btn, i) => {
    btn.classList.remove("active", "completed");
    const sKey = state.sections[i];
    const answered = Object.keys(state.answers[sKey]).length;
    if (i === state.currentSection) btn.classList.add("active");
    else if (answered === 40) btn.classList.add("completed");
  });

  // Progress bar
  const total = state.sections.reduce((a, k) => a + Object.keys(state.answers[k]).length, 0);
  $("progress-fill").style.width = `${(total / 200) * 100}%`;

  // Render questions
  const container = $("questions-container");
  container.innerHTML = "";

  sec.questions.forEach((q, i) => {
    const answered = answers[i] !== undefined;
    const card = document.createElement("div");
    card.className = `question-card ${answered ? "answered" : ""}`;
    card.id = `q-card-${i}`;

    const labels = ["A", "B", "C", "D"];
    card.innerHTML = `
      <div class="q-number">Question ${i + 1} of 40</div>
      <div class="q-text">${q.q}</div>
      <div class="options-grid">
        ${q.opts.map((opt, oi) => `
          <button class="option-btn ${answers[i] === oi ? "selected" : ""}"
            onclick="selectAnswer(${i}, ${oi})" type="button">
            <span class="option-label">${labels[oi]}</span>
            <span>${opt}</span>
          </button>
        `).join("")}
      </div>
    `;
    container.appendChild(card);
  });

  // Footer counts
  updateFooter();
  container.scrollTop = 0;
  window.scrollTo(0, 0);
}

function selectAnswer(qIndex, optIndex) {
  const secKey = state.sections[state.currentSection];
  const wasAnswered = state.answers[secKey][qIndex] !== undefined;
  state.answers[secKey][qIndex] = optIndex;

  // Update card
  const card = $(`q-card-${qIndex}`);
  card.classList.add("answered");
  card.querySelectorAll(".option-btn").forEach((btn, i) => {
    btn.classList.toggle("selected", i === optIndex);
  });

  updateFooter();

  // Update progress bar
  const total = state.sections.reduce((a, k) => a + Object.keys(state.answers[k]).length, 0);
  $("progress-fill").style.width = `${(total / 200) * 100}%`;

  // Update tab completion
  const answered = Object.keys(state.answers[secKey]).length;
  const tabs = document.querySelectorAll(".tab-btn");
  if (answered === 40) tabs[state.currentSection].classList.add("completed");
  saveDraft();
}

function updateFooter() {
  const secKey = state.sections[state.currentSection];
  const answered = Object.keys(state.answers[secKey]).length;
  $("footer-progress").textContent = `${answered}/40 answered`;

  const prevBtn = $("btn-prev");
  const nextBtn = $("btn-next");
  const submitBtn = $("btn-submit");

  prevBtn.disabled = state.currentSection === 0;

  if (state.currentSection === 4) {
    nextBtn.classList.add("hidden");
    submitBtn.classList.remove("hidden");
  } else {
    nextBtn.classList.remove("hidden");
    submitBtn.classList.add("hidden");
  }
}

function navigateSection(dir) {
  const next = state.currentSection + dir;
  if (next < 0 || next > 4) return;
  state.currentSection = next;
  renderSection();
}

function jumpToSection(idx) {
  state.currentSection = idx;
  renderSection();
}

// ── SUBMIT ────────────────────────────────────────────────────────────────────
function confirmSubmit() {
  const total = state.sections.reduce((a, k) => a + Object.keys(state.answers[k]).length, 0);
  const unanswered = 200 - total;
  const msg = unanswered > 0
    ? `You have ${unanswered} unanswered question(s). Are you sure you want to submit?`
    : "Are you ready to submit your exam?";
  if (confirm(msg)) submitExam();
}

function autoSubmit() {
  alert("Time is up! Your exam is being submitted automatically.");
  submitExam();
}

function submitExam() {
  if (state.submitted) return;
  state.submitted = true;
  clearInterval(state.timerInterval);

  const scores = {};
  let totalScore = 0;

  state.sections.forEach(key => {
    const sec = QUESTION_BANK[key];
    let score = 0;
    sec.questions.forEach((q, i) => {
      if (state.answers[key][i] === q.ans) score++;
    });
    scores[key] = score;
    totalScore += score;
  });

  const pct = ((totalScore / 200) * 100).toFixed(1);
  const timeTaken = EXAM_DURATION - state.timeLeft;
  const mins = Math.floor(timeTaken / 60);
  const secs = timeTaken % 60;

  const result = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    student: state.student,
    scores,
    totalScore,
    percentage: pct,
    timeTaken: `${mins}m ${secs}s`,
    answers: state.answers,
  };

  // Save locally
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  existing.push(result);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

  // Submit to Google Sheets if URL is configured
  if (SUBMIT_URL) {
    fetch(SUBMIT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    }).catch(err => console.warn("Remote submit failed:", err));
  }

  // Show success screen
  $("submitted-name").textContent = state.student.name;
  $("submitted-matric").textContent = state.student.matric;
  clearDraft();
  show("screen-submitted");
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
let adminLoggedIn = false;

function goAdmin() { show("screen-admin"); $("admin-login-section").classList.remove("hidden"); $("admin-dashboard").classList.add("hidden"); }

function adminLogin() {
  const pw = $("admin-pw").value;
  if (pw === ADMIN_PASSWORD) {
    adminLoggedIn = true;
    $("admin-login-section").classList.add("hidden");
    $("admin-dashboard").classList.remove("hidden");
    loadAdminResults();
  } else {
    $("admin-error").textContent = "Incorrect password.";
    $("admin-error").classList.remove("hidden");
    setTimeout(() => $("admin-error").classList.add("hidden"), 2000);
  }
}

function adminLogout() {
  adminLoggedIn = false;
  $("admin-login-section").classList.remove("hidden");
  $("admin-dashboard").classList.add("hidden");
  $("admin-pw").value = "";
  show("screen-landing");
}

async function loadAdminResults() {
  $("admin-loading").classList.remove("hidden");
  $("admin-dashboard-content").classList.add("hidden");
  let results = [];
  if (SUBMIT_URL) {
    try {
      const resp = await fetch(SUBMIT_URL + "?action=getResults");
      const data = await resp.json();
      if (Array.isArray(data)) results = data;
    } catch(err) {
      console.warn("Cloud fetch failed, using local:", err);
      results = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    }
  } else {
    results = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  }
  $("admin-loading").classList.add("hidden");
  $("admin-dashboard-content").classList.remove("hidden");
  renderAdminDashboard(results);
}

function refreshResults() { loadAdminResults(); }

function renderAdminDashboard(results) {

  // Stats
  $("stat-total").textContent = results.length;
  if (results.length > 0) {
    const avg = (results.reduce((a, r) => a + parseFloat(r.percentage), 0) / results.length).toFixed(1);
    const highest = Math.max(...results.map(r => parseFloat(r.percentage))).toFixed(1);
    $("stat-avg").textContent = avg + "%";
    $("stat-highest").textContent = highest + "%";
  } else {
    $("stat-avg").textContent = "—";
    $("stat-highest").textContent = "—";
  }

  // Table
  const tbody = $("results-tbody");
  if (results.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No submissions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = results.map((r, i) => {
    const pct = parseFloat(r.percentage);
    const badge = pct >= 70 ? "badge-green" : pct >= 50 ? "badge-yellow" : "badge-red";
    const d = new Date(r.timestamp);
    const dateStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${r.student.name}</strong></td>
        <td>${r.student.matric}</td>
        <td>${r.student.level}</td>
        <td>${r.scores.wtc101}/40</td>
        <td>${r.scores.wtc102}/40</td>
        <td>${r.scores.wtc103}/40</td>
        <td>${r.scores.wtc104}/40</td>
        <td>${r.scores.wtc105}/40</td>
        <td><strong>${r.totalScore}/200</strong></td>
        <td><span class="badge ${badge}">${r.percentage}%</span></td>
        <td>${r.timeTaken}</td>
        <td>${dateStr}</td>
      </tr>
    `;
  }).join("");
}

function exportCSV() {
  const results = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (!results.length) { alert("No results to export."); return; }

  const headers = ["#","Name","Matric","Level","Gender","WTC101","WTC102","WTC103","WTC104","WTC105","Total","Percentage","TimeTaken","Timestamp"];
  const rows = results.map((r, i) => [
    i+1, r.student.name, r.student.matric, r.student.level, r.student.gender,
    r.scores.wtc101, r.scores.wtc102, r.scores.wtc103, r.scores.wtc104, r.scores.wtc105,
    r.totalScore, r.percentage + "%", r.timeTaken, new Date(r.timestamp).toLocaleString()
  ]);

  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `IWT_Results_${new Date().toLocaleDateString()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function clearResults() {
  if (confirm("Are you sure you want to delete ALL results? This cannot be undone.")) {
    localStorage.removeItem(STORAGE_KEY);
    renderAdminDashboard();
  }
}

function newStudent() {
  state.student = { name:"", matric:"", level:"", gender:"" };
  state.currentSection = 0;
  state.answers = { wtc101:{}, wtc102:{}, wtc103:{}, wtc104:{}, wtc105:{} };
  state.timeLeft = EXAM_DURATION;
  state.submitted = false;
  state.examStarted = false;
  clearDraft();
  $("inp-name").value = $("inp-matric").value = $("inp-level").value = $("inp-gender").value = "";
  show("screen-landing");
}

// ── KEYBOARD ENTER ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const draft = loadDraft();
  if (draft) {
    const resume = confirm(`Welcome back, ${draft.student.name}!\nExam in progress — ${Math.floor(draft.timeLeft/60)}m ${draft.timeLeft%60}s remaining.\nResume?`);
    if (resume) {
      state.student = draft.student; state.currentSection = draft.currentSection;
      state.answers = draft.answers; state.timeLeft = draft.timeLeft;
      state.submitted = false; state.examStarted = true;
      show("screen-exam"); renderSection(); startTimer();
    } else { clearDraft(); }
  }
  ["inp-name","inp-matric","inp-level","inp-gender"].forEach(id => {
    $(id)?.addEventListener("keydown", e => { if (e.key === "Enter") startExam(); });
  });
  $("admin-pw")?.addEventListener("keydown", e => { if (e.key === "Enter") adminLogin(); });
});

// Prevent accidental back navigation during exam
window.addEventListener("beforeunload", e => {
  if (!state.submitted && state.timeLeft < EXAM_DURATION && state.timeLeft > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});
