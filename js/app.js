// ── CONFIG ────────────────────────────────────────────────────────────────────
const EXAM_DURATION  = 100 * 60; // 100 minutes
const ADMIN_PASSWORD = "iwtpassword";
const STORAGE_KEY    = "iwt_exam_results";   // local results (fallback)
const ATTEMPTED_KEY  = "iwt_attempted_matrics"; // one-attempt lock
const DRAFT_KEY      = "iwt_exam_draft";     // in-progress session (refresh recovery)

// ✏️ Paste your Google Apps Script Web App URL here
let SUBMIT_URL = "https://script.google.com/macros/s/AKfycbxdxjzNYI2RlrheqU9DN-ynnPBdPIfT1q0Ywio7nuddtPq2_Obcg2EziLd4xgXK0Ffz/exec"; // e.g. "https://script.google.com/macros/s/AKfy.../exec"

// ── STATE ─────────────────────────────────────────────────────────────────────
let state = {
  student:        { name: "", matric: "", level: "", gender: "" },
  sections:       ["wtc101", "wtc102", "wtc103", "wtc104", "wtc105"],
  currentSection: 0,
  answers:        { wtc101: {}, wtc102: {}, wtc103: {}, wtc104: {}, wtc105: {} },
  timerInterval:  null,
  timeLeft:       EXAM_DURATION,
  submitted:      false,
  examStarted:    false,
};

// ── DOM HELPERS ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
};

// ── ONE-ATTEMPT REGISTRY ──────────────────────────────────────────────────────
function getAttempted()       { return JSON.parse(localStorage.getItem(ATTEMPTED_KEY) || "[]"); }
function hasAttempted(matric) { return getAttempted().includes(matric.toUpperCase()); }
function registerAttempt(matric) {
  const list = getAttempted();
  if (!list.includes(matric.toUpperCase())) {
    list.push(matric.toUpperCase());
    localStorage.setItem(ATTEMPTED_KEY, JSON.stringify(list));
  }
}
function removeAttemptLock(matric) {
  const list = getAttempted().filter(m => m !== matric.toUpperCase());
  localStorage.setItem(ATTEMPTED_KEY, JSON.stringify(list));
}

// ── DRAFT / REFRESH RECOVERY ──────────────────────────────────────────────────
function saveDraft() {
  if (!state.examStarted || state.submitted) return;
  const draft = {
    student:        state.student,
    currentSection: state.currentSection,
    answers:        state.answers,
    timeLeft:       state.timeLeft,
  };
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

// ── LANDING ───────────────────────────────────────────────────────────────────
function startExam() {
  const name   = $("inp-name").value.trim();
  const matric = $("inp-matric").value.trim();
  const level  = $("inp-level").value;
  const gender = $("inp-gender").value;

  if (!name || !matric || !level || !gender) {
    showError("Please fill in all fields before starting.");
    return;
  }

  if (hasAttempted(matric)) {
    showError("This matric number has already sat this examination. Contact the admin if this is an error.");
    return;
  }

  state.student        = { name, matric, level, gender };
  state.currentSection = 0;
  state.answers        = { wtc101: {}, wtc102: {}, wtc103: {}, wtc104: {}, wtc105: {} };
  state.timeLeft       = EXAM_DURATION;
  state.submitted      = false;
  state.examStarted    = true;

  // Lock matric immediately — prevents re-entry even on refresh
  registerAttempt(matric);

  show("screen-exam");
  renderSection();
  startTimer();
  saveDraft();
}

function showError(msg) {
  const el = $("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4500);
}

// ── TIMER ─────────────────────────────────────────────────────────────────────
function startTimer() {
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    updateTimerDisplay();
    // Save draft every 15 seconds to preserve time
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
  $("timer-display").textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  const box = $("timer-box");
  box.classList.remove("warning","danger");
  if (state.timeLeft <= 300)      box.classList.add("danger");
  else if (state.timeLeft <= 600) box.classList.add("warning");
}

// ── RENDER SECTION ────────────────────────────────────────────────────────────
function renderSection() {
  const secKey  = state.sections[state.currentSection];
  const sec     = QUESTION_BANK[secKey];
  const answers = state.answers[secKey];

  $("section-title").textContent    = `${sec.title}: ${sec.subject}`;
  $("section-subtitle").textContent = `Section ${state.currentSection + 1} of 5 · 40 Questions`;

  // Tabs — all freely navigable
  document.querySelectorAll(".tab-btn").forEach((btn, i) => {
    btn.classList.remove("active","completed","locked");
    btn.disabled = false;
    const answered = Object.keys(state.answers[state.sections[i]]).length;
    if (i === state.currentSection)   btn.classList.add("active");
    else if (answered === 40)         btn.classList.add("completed");
  });

  // Progress bar
  const total = state.sections.reduce((a,k) => a + Object.keys(state.answers[k]).length, 0);
  $("progress-fill").style.width = `${(total / 200) * 100}%`;

  // Render questions
  const container = $("questions-container");
  container.innerHTML = "";
  const labels = ["A","B","C","D"];

  sec.questions.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = `question-card ${answers[i] !== undefined ? "answered" : ""}`;
    card.id = `q-card-${i}`;
    card.innerHTML = `
      <div class="q-number">Question ${i + 1} of 40</div>
      <div class="q-text">${q.q}</div>
      <div class="options-grid">
        ${q.opts.map((opt, oi) => `
          <button class="option-btn ${answers[i] === oi ? "selected" : ""}"
            onclick="selectAnswer(${i},${oi})" type="button">
            <span class="option-label">${labels[oi]}</span>
            <span>${opt}</span>
          </button>`).join("")}
      </div>`;
    container.appendChild(card);
  });

  updateFooter();
  window.scrollTo(0, 0);
}

function selectAnswer(qIndex, optIndex) {
  const secKey = state.sections[state.currentSection];
  state.answers[secKey][qIndex] = optIndex;

  const card = $(`q-card-${qIndex}`);
  card.classList.add("answered");
  card.querySelectorAll(".option-btn").forEach((btn, i) => {
    btn.classList.toggle("selected", i === optIndex);
  });

  updateFooter();
  const total = state.sections.reduce((a,k) => a + Object.keys(state.answers[k]).length, 0);
  $("progress-fill").style.width = `${(total / 200) * 100}%`;
  saveDraft(); // save every answer
}

function updateFooter() {
  const secKey   = state.sections[state.currentSection];
  const answered = Object.keys(state.answers[secKey]).length;
  $("footer-progress").textContent = `${answered}/40 answered`;

  const prevBtn   = $("btn-prev");
  const nextBtn   = $("btn-next");
  const submitBtn = $("btn-submit");

  // Show/hide Prev
  prevBtn.disabled = state.currentSection === 0;
  prevBtn.classList.remove("hidden");

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
  saveDraft();
}

function jumpToSection(idx) {
  state.currentSection = idx;
  renderSection();
  saveDraft();
}

// ── SUBMIT — Double Consent ───────────────────────────────────────────────────
function confirmSubmit() {
  const total      = state.sections.reduce((a,k) => a + Object.keys(state.answers[k]).length, 0);
  const unanswered = 200 - total;

  const first = unanswered > 0
    ? `⚠️ You still have ${unanswered} unanswered question(s).\n\nAre you sure you want to submit?`
    : `You are about to submit your examination.\n\nAre you sure you want to proceed?`;
  if (!confirm(first)) return;

  const second = `🔒 FINAL CONFIRMATION\n\nOnce submitted, you cannot return to the exam.\n\nDo you confirm your final submission?`;
  if (!confirm(second)) return;

  submitExam();
}

function autoSubmit() {
  if (state.submitted) return;
  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#c62828;color:white;text-align:center;padding:14px;font-weight:700;font-size:1rem;";
  banner.textContent = "⏰ Time is up! Your exam has been automatically submitted.";
  document.body.appendChild(banner);
  submitExam();
}

function submitExam() {
  if (state.submitted) return;
  state.submitted   = true;
  clearInterval(state.timerInterval);

  const scores = {};
  let totalScore = 0;
  state.sections.forEach(key => {
    const sec = QUESTION_BANK[key];
    let score = 0;
    sec.questions.forEach((q, i) => { if (state.answers[key][i] === q.ans) score++; });
    scores[key]  = score;
    totalScore  += score;
  });

  const pct       = ((totalScore / 200) * 100).toFixed(1);
  const timeTaken = EXAM_DURATION - state.timeLeft;
  const result = {
    id:         Date.now(),
    timestamp:  new Date().toISOString(),
    student:    state.student,
    scores,
    totalScore,
    percentage: pct,
    timeTaken:  `${Math.floor(timeTaken/60)}m ${timeTaken%60}s`,
  };

  // Save locally (fallback)
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  existing.push(result);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

  // Submit to Google Sheets
  if (SUBMIT_URL) {
    fetch(SUBMIT_URL, {
      method: "POST", mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    }).catch(err => console.warn("Remote submit failed:", err));
  }

  clearDraft(); // wipe session draft — exam is done

  $("submitted-name").textContent   = result.student.name;
  $("submitted-matric").textContent = result.student.matric;
  show("screen-submitted");
}

// ── NEW STUDENT (after submission) ────────────────────────────────────────────
function newStudent() {
  // Reset state fully for next student
  state.student        = { name: "", matric: "", level: "", gender: "" };
  state.currentSection = 0;
  state.answers        = { wtc101: {}, wtc102: {}, wtc103: {}, wtc104: {}, wtc105: {} };
  state.timeLeft       = EXAM_DURATION;
  state.submitted      = false;
  state.examStarted    = false;
  clearDraft();

  // Clear form fields
  $("inp-name").value   = "";
  $("inp-matric").value = "";
  $("inp-level").value  = "";
  $("inp-gender").value = "";

  show("screen-landing");
}

// ── ADMIN — reads from Google Sheets (cloud) ──────────────────────────────────
let adminLoggedIn = false;

function goAdmin() {
  show("screen-admin");
  $("admin-login-section").classList.remove("hidden");
  $("admin-dashboard").classList.add("hidden");
}

function adminLogin() {
  if ($("admin-pw").value === ADMIN_PASSWORD) {
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
  $("admin-pw").value = "";
  $("admin-login-section").classList.remove("hidden");
  $("admin-dashboard").classList.add("hidden");
  show("screen-landing");
}

// Fetch results from Google Sheets via the Apps Script doGet endpoint
async function loadAdminResults() {
  $("admin-loading").classList.remove("hidden");
  $("admin-dashboard-content").classList.add("hidden");

  let results = [];

  if (SUBMIT_URL) {
    try {
      // doGet returns JSON array of all results
      const resp = await fetch(SUBMIT_URL + "?action=getResults");
      const data = await resp.json();
      if (Array.isArray(data)) results = data;
    } catch (err) {
      console.warn("Cloud fetch failed, falling back to local:", err);
      results = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    }
  } else {
    // No cloud URL — fall back to localStorage
    results = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  }

  $("admin-loading").classList.add("hidden");
  $("admin-dashboard-content").classList.remove("hidden");
  renderAdminDashboard(results);
}

function renderAdminDashboard(results) {
  $("stat-total").textContent = results.length;

  if (results.length > 0) {
    const avg     = (results.reduce((a,r) => a + parseFloat(r.percentage), 0) / results.length).toFixed(1);
    const highest = Math.max(...results.map(r => parseFloat(r.percentage))).toFixed(1);
    $("stat-avg").textContent     = avg + "%";
    $("stat-highest").textContent = highest + "%";
  } else {
    $("stat-avg").textContent = $("stat-highest").textContent = "—";
  }

  const tbody = $("results-tbody");
  if (!results.length) {
    tbody.innerHTML = `<tr><td colspan="14" class="empty-state">No submissions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = results.map(r => {
    const pct     = parseFloat(r.percentage);
    const badge   = pct >= 70 ? "badge-green" : pct >= 50 ? "badge-yellow" : "badge-red";
    const d       = new Date(r.timestamp);
    const dateStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
    return `
      <tr id="row-${r.id}">
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
        <td>
          <button class="btn-sm btn-delete-entry"
            onclick="deleteEntry('${r.id}','${r.student.matric}','${r.student.name}')">🗑 Delete</button>
        </td>
      </tr>`;
  }).join("");
}

// Delete a single entry — removes from localStorage + attempt lock
// (Cloud deletion from Sheets requires the updated backend.gs)
function deleteEntry(id, matric, name) {
  if (!confirm(`Delete entry for:\n👤 ${name}\n📋 ${matric}\n\nThis will allow them to re-sit. Are you sure?`)) return;

  // Remove from local storage
  const updated = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").filter(r => String(r.id) !== String(id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

  // Remove attempt lock
  removeAttemptLock(matric);

  // Remove row from table
  const row = $(`row-${id}`);
  if (row) row.remove();

  // If cloud is configured, also send delete request
  if (SUBMIT_URL) {
    fetch(SUBMIT_URL + `?action=deleteResult&id=${id}`, { mode: "no-cors" })
      .catch(err => console.warn("Cloud delete failed:", err));
  }

  // Re-render stats from remaining rows
  loadAdminResults();
}

function refreshResults() { loadAdminResults(); }

function exportCSV() {
  const rows = [...$("results-tbody").querySelectorAll("tr")].map(tr => {
    return [...tr.querySelectorAll("td")].slice(0, -1).map(td => `"${td.textContent.trim()}"`).join(",");
  });
  if (!rows.length || rows[0].includes("No submissions")) { alert("No results to export."); return; }
  const headers = `"Name","Matric","Level","WTC101","WTC102","WTC103","WTC104","WTC105","Total","Percentage","Time","Submitted At"`;
  const csv  = [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `IWT_Results_${new Date().toLocaleDateString()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function clearResults() {
  if (confirm("Delete ALL local results and attempt records? Cloud (Sheets) data is not affected.")) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ATTEMPTED_KEY);
    loadAdminResults();
  }
}

// ── INIT — Refresh Recovery ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  $("admin-pw")?.addEventListener("keydown", e => { if (e.key === "Enter") adminLogin(); });

  // Check if there is an active in-progress session to recover
  const draft = loadDraft();
  if (draft && !draft.submitted) {
    const recover = confirm(
      `Welcome back, ${draft.student.name}!\n\nYou have an exam in progress.\nTime remaining: ${Math.floor(draft.timeLeft/60)}m ${draft.timeLeft%60}s\n\nResume your exam?`
    );
    if (recover) {
      state.student        = draft.student;
      state.currentSection = draft.currentSection;
      state.answers        = draft.answers;
      state.timeLeft       = draft.timeLeft;
      state.submitted      = false;
      state.examStarted    = true;
      show("screen-exam");
      renderSection();
      startTimer();
    } else {
      clearDraft();
    }
  }
});

// Warn before tab close during active exam
window.addEventListener("beforeunload", e => {
  if (state.examStarted && !state.submitted) {
    saveDraft();
    e.preventDefault();
    e.returnValue = "";
  }
});
