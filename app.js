// ===================================================================
// DROPSHIP CAPITAL & ROI TRACKER - CLIENT ENGINE
// Supports Email + OTP Authentication & Google Apps Script Backend
// ===================================================================

const STORAGE_KEYS = {
  INVESTMENTS: "dropship_investments_v2",
  SETTINGS: "dropship_settings_v2",
  SESSION: "dropship_session_v2",
  API_URL: "dropship_apps_script_url_v3"
};

// Official Google Apps Script Backend URL
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzPVC0M4qFp-KnBYuDqQjyTRX371FWbwz9vXcCUUJTsE6yZ7r_rUUMYwMJjeQdtZ2_deQ/exec";

// Application State
let appSettings = {
  currency: "₹",
  defaultPartner: "Friend"
};

let currentUser = null; // { email, name, role, token, isDemo }
let currentMode = "self"; // "self" | "borrowed"
let currentFilter = "all";
let searchQuery = "";
let editingId = null;
let settlingId = null;
let otpCountdownTimer = null;
let pendingEmail = "";

// Default sample data for demo/offline view
const INITIAL_DEMO_DATA = [
  // 1. Self Investment Cycles (My own money)
  {
    id: "inv-001",
    investmentType: "self",
    userEmail: "investor@example.com",
    title: "Diwali Electronics Stock Batch #1",
    partner: "Friend",
    investedAmount: 50000,
    expectedReturn: 57500,
    actualReturn: 57500,
    profit: 7500,
    roi: 15.0,
    startDate: getOffsetDateString(-35),
    dueDate: getOffsetDateString(-5),
    actualReturnDate: getOffsetDateString(-5),
    status: "Completed",
    notes: "Batch sold out on Shopify in 22 days. Principal + 7.5k profit returned via UPI."
  },
  {
    id: "inv-002",
    investmentType: "self",
    userEmail: "investor@example.com",
    title: "Home Decor & Trending Kitchenware Batch #2",
    partner: "Friend",
    investedAmount: 75000,
    expectedReturn: 86250,
    actualReturn: null,
    profit: 11250,
    roi: 15.0,
    startDate: getOffsetDateString(-18),
    dueDate: getOffsetDateString(12),
    actualReturnDate: null,
    status: "Active",
    notes: "Active ad campaign on Meta running. Expected clearance before month-end."
  },
  // 2. Borrowed from Others Cycles (Borrowed money with your spread cut)
  {
    id: "inv-101",
    investmentType: "borrowed",
    userEmail: "investor@example.com",
    title: "Kitchen Accessories Batch - Rohan Loan",
    partner: "Rohan (Lender)",
    investedAmount: 50000, // Borrowed principal
    expectedReturn: 57000, // Total gross return from dropshipping business
    lenderReturn: 56000,   // Amount to pay back to lender (Principal + lender profit)
    myProfitCut: 1000,     // Your arbitrage profit kept
    actualReturn: 57000,   // Actual gross received
    actualLenderReturn: 56000, // Actual paid to lender
    profit: 1000,          // Your net profit
    roi: 14.0,             // Gross business ROI
    startDate: getOffsetDateString(-30),
    dueDate: getOffsetDateString(-2),
    actualReturnDate: getOffsetDateString(-2),
    status: "Completed",
    notes: "Borrowed 50k from Rohan. Business returned 57k. Paid Rohan 56k (+6k profit to him), kept 1k net profit."
  },
  {
    id: "inv-102",
    investmentType: "borrowed",
    userEmail: "investor@example.com",
    title: "Smart LED Lights Batch - Amit Loan",
    partner: "Amit (Friend/Lender)",
    investedAmount: 80000,
    expectedReturn: 92000,
    lenderReturn: 90000,
    myProfitCut: 2000,
    actualReturn: null,
    profit: 2000,
    roi: 15.0,
    startDate: getOffsetDateString(-12),
    dueDate: getOffsetDateString(18),
    actualReturnDate: null,
    status: "Active",
    notes: "Borrowed 80k. Business expected return 92k. Promised Amit 90k, keeping 2k net spread."
  }
];

let investments = [];

// Date Helpers
function getOffsetDateString(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `${appSettings.currency} ${num.toLocaleString("en-IN")}`;
}

// -------------------------------------------------------------
// TOAST NOTIFICATIONS
// -------------------------------------------------------------
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "toast-error" : "toast-success"}`;
  toast.innerHTML = `
    <span>${type === "error" ? "⚠️" : "✓"}</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.25s";
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// -------------------------------------------------------------
// GOOGLE APPS SCRIPT API CLIENT
// -------------------------------------------------------------
function getApiUrl() {
  return localStorage.getItem(STORAGE_KEYS.API_URL) || DEFAULT_API_URL;
}

async function callBackend(action, payload = {}) {
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    throw new Error("NO_API_URL");
  }

  setSyncStatus("syncing", "Syncing with Google Sheets...");

  try {
    const fullPayload = {
      action,
      token: currentUser ? currentUser.token : null,
      email: currentUser ? currentUser.email : payload.email,
      ...payload
    };

    // Google Apps Script requires POST using text/plain to avoid CORS preflight issues
    const response = await fetch(apiUrl, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(fullPayload)
    });

    const data = await response.json();
    setSyncStatus("online", "Synced with Google Sheets");
    return data;
  } catch (err) {
    console.warn("Backend API sync failed:", err);
    setSyncStatus("offline", "Offline / Local Mode");
    throw err;
  }
}

function setSyncStatus(status, text) {
  const badge = document.getElementById("cloud-sync-status");
  const textSpan = document.getElementById("sync-status-text");
  if (!badge || !textSpan) return;

  badge.className = "cloud-sync-badge";
  if (status === "online") badge.classList.add("sync-online");
  else if (status === "syncing") badge.classList.add("sync-syncing");
  else badge.classList.add("sync-offline");

  textSpan.textContent = text;
}

// -------------------------------------------------------------
// AUTHENTICATION ENGINE (EMAIL + OTP)
// -------------------------------------------------------------
function checkExistingSession() {
  // Strict Security Policy: Session closes immediately on page refresh or tab closing
  currentUser = null;
  investments = [];
  try {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  } catch (e) {
    // ignore
  }
  showAuthView();
}

function showAuthView() {
  document.getElementById("auth-section").style.display = "flex";
  document.getElementById("app-section").style.display = "none";
  resetAuthForms();
}

function showDashboardView() {
  document.getElementById("auth-section").style.display = "none";
  document.getElementById("app-section").style.display = "block";

  if (currentUser) {
    document.getElementById("user-email-display").textContent = currentUser.email;
    const initial = (currentUser.name || currentUser.email || "U")[0].toUpperCase();
    document.getElementById("user-avatar").textContent = initial;

    if (currentUser.isDemo) {
      setSyncStatus("offline", "Demo / Offline Mode");
    } else {
      setSyncStatus("online", "Synced with Google Sheets");
    }
  }
}

function resetAuthForms() {
  document.getElementById("auth-email-form").classList.add("active");
  document.getElementById("auth-otp-form").classList.remove("active");
  document.getElementById("auth-status-msg").className = "auth-status-msg";
  document.getElementById("auth-status-msg").textContent = "";
  clearInterval(otpCountdownTimer);
}

function showAuthStatus(message, isError = false) {
  const msgDiv = document.getElementById("auth-status-msg");
  msgDiv.className = `auth-status-msg ${isError ? "error" : "success"}`;
  msgDiv.textContent = message;
}

// Step 1: Send OTP
async function handleSendOtp(e) {
  e.preventDefault();
  const emailInput = document.getElementById("auth-email-input");
  const email = emailInput.value.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    showAuthStatus("Please enter a valid email address.", true);
    return;
  }

  pendingEmail = email;
  const btn = document.getElementById("btn-send-otp");
  btn.disabled = true;
  btn.textContent = "Checking whitelist & sending code...";

  const apiUrl = getApiUrl();

  // If no backend URL configured, notify user or fallback to demo
  if (!apiUrl) {
    btn.disabled = false;
    btn.textContent = "Send 6-Digit Login Code →";
    showAuthStatus("Google Apps Script URL is not configured yet. Click '⚙️ Connect Google Script' below to add your URL, or test with 'Preview Demo / Offline'.", true);
    return;
  }

  try {
    const res = await callBackend("requestOtp", { email });
    btn.disabled = false;
    btn.textContent = "Send 6-Digit Login Code →";

    if (res.success) {
      transitionToOtpStep(email, res.message);
    } else {
      showAuthStatus(res.message || "Email not authorized. Access is strictly whitelist-only.", true);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Send 6-Digit Login Code →";
    showAuthStatus("Connection error: Unable to reach Google Script. Check your Web App URL.", true);
  }
}

function transitionToOtpStep(email, successMessage) {
  document.getElementById("auth-email-form").classList.remove("active");
  document.getElementById("auth-otp-form").classList.add("active");
  document.getElementById("auth-target-email").textContent = email;
  showAuthStatus(successMessage || "Code sent! Check your inbox.");

  // Clear previous OTP boxes
  document.querySelectorAll(".otp-digit").forEach(box => box.value = "");
  document.querySelector(".otp-digit[data-idx='0']").focus();

  startOtpCountdown(60);
}

function startOtpCountdown(seconds) {
  clearInterval(otpCountdownTimer);
  let remaining = seconds;
  const countdownSpan = document.getElementById("otp-countdown");
  const timerText = document.getElementById("otp-timer-text");
  const resendBtn = document.getElementById("btn-resend-otp");

  timerText.style.display = "inline";
  resendBtn.style.display = "none";
  countdownSpan.textContent = remaining;

  otpCountdownTimer = setInterval(() => {
    remaining--;
    countdownSpan.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(otpCountdownTimer);
      timerText.style.display = "none";
      resendBtn.style.display = "inline";
    }
  }, 1000);
}

// Step 2: Verify OTP
async function handleVerifyOtp(e) {
  e.preventDefault();
  const digits = Array.from(document.querySelectorAll(".otp-digit")).map(d => d.value.trim());
  const otpCode = digits.join("");

  if (otpCode.length !== 6) {
    showAuthStatus("Please enter all 6 digits of the code.", true);
    return;
  }

  const btn = document.getElementById("btn-verify-otp");
  btn.disabled = true;
  btn.textContent = "Verifying code...";

  try {
    const res = await callBackend("verifyOtp", { email: pendingEmail, otp: otpCode });
    btn.disabled = false;
    btn.textContent = "Verify & Access Dashboard";

    if (res.success && res.token) {
      currentUser = {
        email: res.user.email,
        name: res.user.name || "Partner",
        role: res.user.role || "investor",
        token: res.token,
        isDemo: false
      };
      // Keep session strictly in-memory (closes immediately on page refresh or tab closing)
      try {
        localStorage.removeItem(STORAGE_KEYS.SESSION);
        sessionStorage.removeItem(STORAGE_KEYS.SESSION);
      } catch (e) {}

      showDashboardView();
      loadData();
      showToast(`Welcome back, ${currentUser.name}!`, "success");
    } else {
      showAuthStatus(res.message || "Invalid or expired code. Please try again.", true);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Verify & Access Dashboard";
    showAuthStatus("Verification failed: " + err.message, true);
  }
}

// Demo / Offline Login Mode
function handleDemoLogin() {
  currentUser = {
    email: "demo@dropship-tracker.local",
    name: "Demo Investor",
    role: "admin",
    token: "demo_token_" + Date.now(),
    isDemo: true
  };
  try {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  } catch (e) {}

  showDashboardView();
  loadData();
  showToast("Loaded in Demo / Offline Mode", "info");
}

function handleLogout() {
  if (confirm("Are you sure you want to log out?")) {
    currentUser = null;
    investments = [];
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      localStorage.removeItem(STORAGE_KEYS.INVESTMENTS);
      sessionStorage.removeItem(STORAGE_KEYS.SESSION);
    } catch (e) {}
    showAuthView();
    showToast("Logged out successfully.");
  }
}

// -------------------------------------------------------------
// DATA MANAGEMENT & SYNC
// -------------------------------------------------------------
async function loadData() {
  // 1. Try loading cached local data first for zero latency
  try {
    const cached = localStorage.getItem(STORAGE_KEYS.INVESTMENTS);
    if (cached) {
      investments = JSON.parse(cached);
      renderApp();
    } else if (currentUser && currentUser.isDemo) {
      investments = INITIAL_DEMO_DATA;
      renderApp();
    }
  } catch (e) {
    investments = INITIAL_DEMO_DATA;
  }

  // 2. If authenticated with real Google Apps Script, fetch fresh data
  if (currentUser && !currentUser.isDemo && getApiUrl()) {
    try {
      const res = await callBackend("getInvestments");
      if (res.success && Array.isArray(res.investments)) {
        investments = res.investments;
        localStorage.setItem(STORAGE_KEYS.INVESTMENTS, JSON.stringify(investments));
        renderApp();
      }
    } catch (err) {
      console.warn("Could not sync with Google Sheets, using local cache.", err);
    }
  }
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEYS.INVESTMENTS, JSON.stringify(investments));
}

// -------------------------------------------------------------
// DASHBOARD MODE SWITCH (SELF vs BORROWED FROM OTHERS)
// -------------------------------------------------------------
function setDashboardMode(mode) {
  currentMode = mode;
  
  const tabSelf = document.getElementById("tab-mode-self");
  const tabBorrowed = document.getElementById("tab-mode-borrowed");

  if (tabSelf && tabBorrowed) {
    if (mode === "self") {
      tabSelf.classList.add("active");
      tabBorrowed.classList.remove("active");
    } else {
      tabBorrowed.classList.add("active");
      tabSelf.classList.remove("active");
    }
  }

  renderApp();
}

// -------------------------------------------------------------
// CALCULATIONS & METRICS
// -------------------------------------------------------------
function computeMetrics() {
  const todayStr = new Date().toISOString().split("T")[0];
  const modeDeals = investments.filter(item => (item.investmentType || "self") === currentMode);

  if (currentMode === "borrowed") {
    let totalBorrowed = 0;
    let activeBorrowed = 0;
    let totalMyCutRealized = 0;
    let pendingMyCut = 0;
    let totalPaidToLenders = 0;
    let overdueCount = 0;
    let urgentCycles = [];

    modeDeals.forEach(item => {
      const principal = Number(item.investedAmount) || 0;
      totalBorrowed += principal;

      const myCut = item.myProfitCut != null 
        ? Number(item.myProfitCut) 
        : (Number(item.expectedReturn || 0) - Number(item.lenderReturn || 0));

      const lenderPay = Number(item.lenderReturn) || (Number(item.expectedReturn || 0) - myCut);

      if (item.status === "Active" && item.dueDate < todayStr) {
        overdueCount++;
      }

      if (item.status === "Completed") {
        const actualGross = item.actualReturn != null ? Number(item.actualReturn) : Number(item.expectedReturn || 0);
        const actualLender = item.actualLenderReturn != null ? Number(item.actualLenderReturn) : lenderPay;
        const realizedCut = actualGross - actualLender;

        totalMyCutRealized += realizedCut;
        totalPaidToLenders += actualLender;
      } else {
        activeBorrowed += principal;
        pendingMyCut += myCut;

        const daysDiff = Math.ceil((new Date(item.dueDate) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 7) {
          urgentCycles.push({ ...item, daysDiff });
        }
      }
    });

    return {
      mode: "borrowed",
      totalBorrowed,
      activeBorrowed,
      totalMyCutRealized,
      pendingMyCut,
      totalPaidToLenders,
      overdueCount,
      urgentCycles,
      count: modeDeals.length
    };
  }

  // Default: Self Investment Mode
  let totalInvested = 0;
  let activePrincipal = 0;
  let totalProfitRealized = 0;
  let pendingProfit = 0;
  let completedCount = 0;
  let totalRoiSum = 0;
  let overdueCount = 0;
  let urgentCycles = [];

  modeDeals.forEach(item => {
    const amt = Number(item.investedAmount) || 0;
    totalInvested += amt;
    
    if (item.status === "Active" && item.dueDate < todayStr) {
      overdueCount++;
    }

    if (item.status === "Completed") {
      completedCount++;
      const realizedProfit = (item.actualReturn != null ? item.actualReturn : item.expectedReturn) - amt;
      totalProfitRealized += realizedProfit;
      const dealRoi = amt > 0 ? (realizedProfit / amt) * 100 : 0;
      totalRoiSum += dealRoi;
    } else {
      activePrincipal += amt;
      pendingProfit += (Number(item.expectedReturn) - amt) || 0;

      const daysDiff = Math.ceil((new Date(item.dueDate) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 7) {
        urgentCycles.push({ ...item, daysDiff });
      }
    }
  });

  const avgRoi = completedCount > 0 ? (totalRoiSum / completedCount).toFixed(1) : (modeDeals.length > 0 ? "15.0" : "0.0");

  return {
    mode: "self",
    totalInvested,
    activePrincipal,
    totalProfitRealized,
    pendingProfit,
    avgRoi,
    completedCount,
    overdueCount,
    urgentCycles,
    count: modeDeals.length
  };
}

// Render Metrics & Dynamic KPI Labels
function renderMetrics() {
  const m = computeMetrics();

  if (m.mode === "borrowed") {
    // Dynamic KPI Labels for Borrowed Mode
    const lbl1 = document.getElementById("lbl-card-1");
    const sub1 = document.getElementById("sub-card-1");
    if (lbl1) lbl1.textContent = "Total Borrowed Capital";
    if (sub1) sub1.textContent = "Capital borrowed from lenders";
    document.getElementById("stat-total-invested").textContent = formatCurrency(m.totalBorrowed);

    const lbl2 = document.getElementById("lbl-card-2");
    const sub2 = document.getElementById("sub-card-2");
    if (lbl2) lbl2.textContent = "Active Borrowed Funds";
    if (sub2) sub2.textContent = "Funds currently rotating in cycles";
    document.getElementById("stat-active-principal").textContent = formatCurrency(m.activeBorrowed);

    const lbl3 = document.getElementById("lbl-card-3");
    const sub3 = document.getElementById("sub-card-3");
    if (lbl3) lbl3.textContent = "Your Net Profit Kept";
    if (sub3) sub3.textContent = "Arbitrage profit kept in your pocket";
    document.getElementById("stat-profit-realized").textContent = `+${formatCurrency(m.totalMyCutRealized)}`;

    const lbl4 = document.getElementById("lbl-card-4");
    const sub4 = document.getElementById("sub-card-4");
    if (lbl4) lbl4.textContent = "Pending Your Cut";
    if (sub4) sub4.textContent = "Expected cut once active cycles settle";
    document.getElementById("stat-pending-profit").textContent = `+${formatCurrency(m.pendingMyCut)}`;

    const lbl5 = document.getElementById("lbl-card-5");
    const sub5 = document.getElementById("sub-card-5");
    if (lbl5) lbl5.textContent = "Paid to Lenders";
    if (sub5) sub5.textContent = "Principal + lender profit returned";
    document.getElementById("stat-avg-roi").textContent = formatCurrency(m.totalPaidToLenders);
  } else {
    // Dynamic KPI Labels for Self Mode
    const lbl1 = document.getElementById("lbl-card-1");
    const sub1 = document.getElementById("sub-card-1");
    if (lbl1) lbl1.textContent = "Total Capital Invested";
    if (sub1) sub1.textContent = "Cumulative capital deployed";
    document.getElementById("stat-total-invested").textContent = formatCurrency(m.totalInvested);

    const lbl2 = document.getElementById("lbl-card-2");
    const sub2 = document.getElementById("sub-card-2");
    if (lbl2) lbl2.textContent = "Active In Rotation";
    if (sub2) sub2.textContent = "Currently in dropshipping cycles";
    document.getElementById("stat-active-principal").textContent = formatCurrency(m.activePrincipal);

    const lbl3 = document.getElementById("lbl-card-3");
    const sub3 = document.getElementById("sub-card-3");
    if (lbl3) lbl3.textContent = "Total Profit Earned";
    if (sub3) sub3.textContent = "Net extra money earned & settled in hand";
    document.getElementById("stat-profit-realized").textContent = `+${formatCurrency(m.totalProfitRealized)}`;

    const lbl4 = document.getElementById("lbl-card-4");
    const sub4 = document.getElementById("sub-card-4");
    if (lbl4) lbl4.textContent = "Pending Profit";
    if (sub4) sub4.textContent = "Expected returns from active cycles";
    document.getElementById("stat-pending-profit").textContent = `+${formatCurrency(m.pendingProfit)}`;

    const lbl5 = document.getElementById("lbl-card-5");
    const sub5 = document.getElementById("sub-card-5");
    if (lbl5) lbl5.textContent = "Avg Cycle Return";
    if (sub5) sub5.textContent = "Avg return per 30-day cycle";
    document.getElementById("stat-avg-roi").textContent = `${m.avgRoi}%`;
  }

  // Reminder banner
  const banner = document.getElementById("reminder-banner");
  if (m.urgentCycles.length > 0) {
    const cycle = m.urgentCycles[0];
    banner.style.display = "flex";
    let text = "";
    const isBorrowed = (cycle.investmentType === "borrowed");
    const payoutLabel = isBorrowed 
      ? `Gross: ${formatCurrency(cycle.expectedReturn)} (Pay lender: ${formatCurrency(cycle.lenderReturn || cycle.expectedReturn)})`
      : `Payout: <strong>${formatCurrency(cycle.expectedReturn)}</strong>`;

    const escapedTitle = escapeHtml(cycle.title || "Investment Batch");
    if (cycle.daysDiff < 0) {
      text = `<span class="reminder-highlight">⚠️ OVERDUE by ${Math.abs(cycle.daysDiff)} days:</span> "${escapedTitle}" (${payoutLabel}) was due on ${formatDate(cycle.dueDate)}.`;
    } else if (cycle.daysDiff === 0) {
      text = `<span class="reminder-highlight">🔔 DUE TODAY:</span> "${escapedTitle}" (${payoutLabel}) is scheduled for return today!`;
    } else {
      text = `<span class="reminder-highlight">⏳ Due in ${cycle.daysDiff} days:</span> "${escapedTitle}" (${payoutLabel}) scheduled on ${formatDate(cycle.dueDate)}.`;
    }
    document.getElementById("reminder-text-span").innerHTML = text;
  } else {
    banner.style.display = "none";
  }
}

// Render Monthly Chart
function renderProfitChart() {
  const chartWrapper = document.getElementById("profit-chart");
  chartWrapper.innerHTML = "";

  const modeDeals = investments.filter(item => (item.investmentType || "self") === currentMode);

  const monthly = {};
  modeDeals.forEach(item => {
    const date = item.actualReturnDate || item.dueDate || item.startDate;
    if (!date) return;
    const [year, month] = date.split("-");
    const key = `${month}/${year.slice(2)}`;
    
    let profit = 0;
    if (currentMode === "borrowed") {
      if (item.status === "Completed") {
        const actualGross = item.actualReturn != null ? Number(item.actualReturn) : Number(item.expectedReturn || 0);
        const actualLender = item.actualLenderReturn != null ? Number(item.actualLenderReturn) : Number(item.lenderReturn || 0);
        profit = actualGross - actualLender;
      } else {
        profit = Number(item.myProfitCut) || (Number(item.expectedReturn || 0) - Number(item.lenderReturn || 0));
      }
    } else {
      profit = item.status === "Completed"
        ? ((item.actualReturn != null ? item.actualReturn : item.expectedReturn) - item.investedAmount)
        : (item.expectedReturn - item.investedAmount);
    }

    monthly[key] = (monthly[key] || 0) + Math.max(0, profit);
  });

  const keys = Object.keys(monthly);
  if (keys.length === 0) {
    chartWrapper.innerHTML = `<div class="empty-state" style="padding:1rem;">No ${currentMode === 'borrowed' ? 'borrowed' : 'self'} cycles recorded yet.</div>`;
    return;
  }

  const maxVal = Math.max(...Object.values(monthly), 5000);

  keys.slice(-6).forEach(k => {
    const val = monthly[k];
    const pct = Math.max(12, Math.round((val / maxVal) * 100));

    const group = document.createElement("div");
    group.className = "chart-bar-group";
    group.innerHTML = `
      <span class="chart-value-tooltip">${formatCurrency(val)}</span>
      <div class="chart-bar-wrapper">
        <div class="chart-bar" style="height: ${pct}%;"></div>
      </div>
      <span class="chart-label">${k}</span>
    `;
    chartWrapper.appendChild(group);
  });
}

// Render Capital Allocation Pie / Donut Chart (Modern Invoicing / Status Card Design)
function renderPieChart() {
  const svg = document.getElementById("pie-chart-svg");
  const legend = document.getElementById("pie-legend");
  const centerLbl = document.getElementById("pie-center-lbl");
  const centerVal = document.getElementById("pie-center-total");
  if (!svg || !legend || !centerVal) return;

  svg.innerHTML = "";
  legend.innerHTML = "";

  const modeDeals = investments.filter(item => (item.investmentType || "self") === currentMode);
  const todayStr = new Date().toISOString().split("T")[0];

  let segments = [];

  if (currentMode === "borrowed") {
    let activeBorrowed = 0;
    let returnedLender = 0;
    let totalMyCut = 0;
    let overdueBorrowed = 0;

    modeDeals.forEach(item => {
      const amt = Number(item.investedAmount) || 0;
      const isOverdue = (item.status === "Active" && item.dueDate < todayStr);

      if (item.status === "Completed") {
        const actualLender = item.actualLenderReturn != null ? Number(item.actualLenderReturn) : Number(item.lenderReturn || amt);
        returnedLender += actualLender;

        const actualGross = item.actualReturn != null ? Number(item.actualReturn) : Number(item.expectedReturn || 0);
        totalMyCut += Math.max(0, actualGross - actualLender);
      } else {
        if (isOverdue) {
          overdueBorrowed += amt;
        } else {
          activeBorrowed += amt;
        }
      }
    });

    segments = [
      { label: "Paid", fullLabel: "Paid to Lenders", value: returnedLender, color: "#4B5223" },
      { label: "Pending", fullLabel: "Active Borrowed", value: activeBorrowed, color: "#767E42" },
      { label: "Profit Cut", fullLabel: "Your Profit Cut", value: totalMyCut, color: "#BAC095" },
      { label: "Overdue", fullLabel: "Overdue Borrowed", value: overdueBorrowed, color: overdueBorrowed > 0 ? "#DC2626" : "#262817" }
    ];
  } else {
    // Self mode
    let activeCapital = 0;
    let returnedCapital = 0;
    let realizedProfit = 0;
    let overdueCapital = 0;

    modeDeals.forEach(item => {
      const amt = Number(item.investedAmount) || 0;
      const isOverdue = (item.status === "Active" && item.dueDate < todayStr);

      if (item.status === "Completed") {
        returnedCapital += amt;
        const profit = (item.actualReturn != null ? item.actualReturn : item.expectedReturn) - amt;
        realizedProfit += Math.max(0, profit);
      } else {
        if (isOverdue) {
          overdueCapital += amt;
        } else {
          activeCapital += amt;
        }
      }
    });

    segments = [
      { label: "Paid", fullLabel: "Returned Principal", value: returnedCapital, color: "#4B5223" },
      { label: "Pending", fullLabel: "Active In Rotation", value: activeCapital, color: "#767E42" },
      { label: "Profit", fullLabel: "Realized Net Profit", value: realizedProfit, color: "#BAC095" },
      { label: "Overdue", fullLabel: "Overdue Deals", value: overdueCapital, color: overdueCapital > 0 ? "#DC2626" : "#262817" }
    ];
  }

  const totalSum = segments.reduce((sum, s) => sum + s.value, 0);

  // Determine default center display
  let defaultLabel = "Paid";
  let defaultValue = "0%";

  if (totalSum > 0) {
    if (segments[0].value > 0) {
      defaultLabel = segments[0].label;
      defaultValue = `${Math.round((segments[0].value / totalSum) * 100)}%`;
    } else if (segments[1].value > 0) {
      defaultLabel = segments[1].label;
      defaultValue = `${Math.round((segments[1].value / totalSum) * 100)}%`;
    } else {
      const firstValid = segments.find(s => s.value > 0);
      if (firstValid) {
        defaultLabel = firstValid.label;
        defaultValue = `${Math.round((firstValid.value / totalSum) * 100)}%`;
      }
    }
  } else {
    defaultLabel = "Status";
    defaultValue = "0%";
  }

  function updateCenter(lbl, val) {
    if (centerLbl) centerLbl.textContent = lbl;
    if (centerVal) centerVal.textContent = val;
  }

  function restoreDefaultCenter() {
    updateCenter(defaultLabel, defaultValue);
  }

  restoreDefaultCenter();

  const radius = 54;
  const circumference = 2 * Math.PI * radius; // ~339.29
  const nonZeroSegments = segments.filter(s => s.value > 0);
  const gap = nonZeroSegments.length > 1 ? 4 : 0; // Clean white separator between arcs

  let accumulatedRatio = 0;

  if (nonZeroSegments.length === 0) {
    svg.innerHTML = `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="rgba(61, 65, 39, 0.12)" stroke-width="18" />`;
  } else {
    nonZeroSegments.forEach(seg => {
      const ratio = seg.value / totalSum;
      const arcLength = ratio * circumference;
      const strokeDash = Math.max(0, arcLength - gap);
      const strokeSpace = circumference - strokeDash;
      const strokeOffset = -accumulatedRatio * circumference;
      const pct = Math.round(ratio * 100);

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "80");
      circle.setAttribute("cy", "80");
      circle.setAttribute("r", radius);
      circle.setAttribute("class", "pie-segment");
      circle.setAttribute("stroke", seg.color);
      circle.setAttribute("stroke-dasharray", `${strokeDash} ${strokeSpace}`);
      circle.setAttribute("stroke-dashoffset", strokeOffset);
      circle.setAttribute("data-label", seg.label);

      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${seg.fullLabel || seg.label}: ${formatCurrency(seg.value)} (${pct}%)`;
      circle.appendChild(title);

      circle.addEventListener("mouseenter", () => {
        updateCenter(seg.label, `${pct}%`);
      });
      circle.addEventListener("mouseleave", () => {
        restoreDefaultCenter();
      });

      svg.appendChild(circle);
      accumulatedRatio += ratio;
    });
  }

  // Render Legend Rows
  segments.forEach(seg => {
    const pct = totalSum > 0 ? Math.round((seg.value / totalSum) * 100) : 0;
    const itemDiv = document.createElement("div");
    itemDiv.className = "pie-legend-item";
    itemDiv.setAttribute("data-label", seg.label);

    itemDiv.innerHTML = `
      <div class="pie-legend-left">
        <span class="pie-legend-dot" style="background:${seg.color};"></span>
        <span class="pie-legend-name">${escapeHtml(seg.label)}</span>
        <span class="pie-legend-amt">${formatCurrency(seg.value)}</span>
      </div>
      <div class="pie-legend-pct">${pct}%</div>
    `;

    itemDiv.addEventListener("mouseenter", () => {
      updateCenter(seg.label, `${pct}%`);
      const match = svg.querySelector(`[data-label="${seg.label}"]`);
      if (match) match.style.strokeWidth = "21px";
    });
    itemDiv.addEventListener("mouseleave", () => {
      restoreDefaultCenter();
      const match = svg.querySelector(`[data-label="${seg.label}"]`);
      if (match) match.style.strokeWidth = "";
    });

    legend.appendChild(itemDiv);
  });
}

// Render Table
function renderTable() {
  const theadRow = document.getElementById("table-head-row");
  const tbody = document.getElementById("deals-tbody");
  tbody.innerHTML = "";
  const todayStr = new Date().toISOString().split("T")[0];

  // Dynamic Table Head
  if (currentMode === "borrowed") {
    theadRow.innerHTML = `
      <th>Batch & Lender</th>
      <th>Borrowed Principal</th>
      <th>Business Return</th>
      <th>Paid to Lender</th>
      <th>Your Profit Cut</th>
      <th>Timeline & Due Date</th>
      <th>Status</th>
      <th style="text-align: right;">Actions</th>
    `;
  } else {
    theadRow.innerHTML = `
      <th>Batch / Description</th>
      <th>Principal Invested</th>
      <th>Return Amount</th>
      <th>Extra Profit & ROI</th>
      <th>Timeline & Due Date</th>
      <th>Status</th>
      <th style="text-align: right;">Actions</th>
    `;
  }

  // Filter deals
  let filtered = investments.filter(item => {
    if ((item.investmentType || "self") !== currentMode) return false;

    if (currentFilter === "active" && item.status !== "Active") return false;
    if (currentFilter === "completed" && item.status !== "Completed") return false;
    if (currentFilter === "overdue") {
      if (item.status !== "Active" || item.dueDate >= todayStr) return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (item.title || "").toLowerCase().includes(q);
      const matchNotes = (item.notes || "").toLowerCase().includes(q);
      const matchPartner = (item.partner || "").toLowerCase().includes(q);
      if (!matchTitle && !matchNotes && !matchPartner) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    if (a.status === "Active" && b.status !== "Active") return -1;
    if (b.status === "Active" && a.status !== "Active") return 1;
    return new Date(b.startDate) - new Date(a.startDate);
  });

  if (filtered.length === 0) {
    const emptyMsg = currentMode === "borrowed"
      ? "No borrowed investment cycles found. Click 'New Investment' to record one."
      : "No self investment cycles found. Click 'New Investment' to record one.";

    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state">
            <svg class="empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            <p>${emptyMsg}</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(deal => {
    const isOverdue = deal.status === "Active" && deal.dueDate < todayStr;

    let statusPill = "";
    if (deal.status === "Completed") {
      statusPill = `<span class="status-pill status-completed"><span class="status-dot"></span>Returned</span>`;
    } else if (isOverdue) {
      statusPill = `<span class="status-pill status-overdue"><span class="status-dot"></span>Overdue</span>`;
    } else {
      statusPill = `<span class="status-pill status-active"><span class="status-dot"></span>Active</span>`;
    }

    const tr = document.createElement("tr");

    if (currentMode === "borrowed") {
      // Borrowed row
      const principal = Number(deal.investedAmount) || 0;
      const grossReturn = deal.status === "Completed" ? (deal.actualReturn || deal.expectedReturn) : deal.expectedReturn;
      const lenderPay = deal.status === "Completed" ? (deal.actualLenderReturn || deal.lenderReturn) : deal.lenderReturn;
      const lenderProfit = (Number(lenderPay) || 0) - principal;

      const myCut = deal.status === "Completed"
        ? (deal.myProfitCut != null ? deal.myProfitCut : (grossReturn - lenderPay))
        : (deal.myProfitCut != null ? deal.myProfitCut : (deal.expectedReturn - deal.lenderReturn));

      tr.innerHTML = `
        <td>
          <span class="deal-title-cell">${escapeHtml(deal.title)}</span>
          <span class="deal-partner">Lender: <strong>${escapeHtml(deal.partner || "Lender")}</strong></span>
        </td>
        <td>
          <strong>${formatCurrency(principal)}</strong>
        </td>
        <td>
          <span style="font-weight:600; color:var(--text-primary);">${formatCurrency(grossReturn)}</span>
          <div style="font-size:0.75rem; color:var(--text-muted);">${(deal.roi || 0).toFixed(1)}% Gross ROI</div>
        </td>
        <td>
          <span style="font-weight:600; color:var(--text-primary);">${formatCurrency(lenderPay)}</span>
          <div style="font-size:0.75rem; color:var(--accent-amber);">+${formatCurrency(lenderProfit)} to lender</div>
        </td>
        <td>
          <span class="metric-profit-tag" style="background:rgba(212, 222, 149, 0.45); color:var(--color-forest); padding:0.2rem 0.5rem; border-radius:6px; font-weight:700;">+${formatCurrency(myCut)}</span>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">Your net cut</div>
        </td>
        <td>
          <div style="font-size:0.8rem; color:var(--text-secondary);">${formatDate(deal.startDate)}</div>
          <div style="font-size:0.75rem; color: ${isOverdue ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight: ${isOverdue ? '600' : 'normal'};">
            Due: ${formatDate(deal.dueDate)}
          </div>
        </td>
        <td>${statusPill}</td>
        <td style="text-align: right;">
          <div style="display:inline-flex; gap:0.4rem;">
            ${deal.status === 'Active' ? `
              <button class="btn btn-sm btn-primary" onclick="openSettleModal('${deal.id}')" title="Settle deal & record your cut">
                ✓ Settle
              </button>
            ` : ''}
            <button class="btn btn-sm btn-secondary" onclick="openEditModal('${deal.id}')" title="Edit details">
              ✎
            </button>
            <button class="btn btn-sm btn-secondary" onclick="deleteDeal('${deal.id}')" title="Delete record" style="color:var(--accent-rose);">
              ✕
            </button>
          </div>
        </td>
      `;
    } else {
      // Self row
      const finalProfit = deal.status === "Completed" 
        ? ((deal.actualReturn != null ? deal.actualReturn : deal.expectedReturn) - deal.investedAmount) 
        : (deal.expectedReturn - deal.investedAmount);

      tr.innerHTML = `
        <td>
          <span class="deal-title-cell">${escapeHtml(deal.title)}</span>
          <span class="deal-partner">Recipient: ${escapeHtml(deal.partner || "Friend")}</span>
        </td>
        <td>
          <strong>${formatCurrency(deal.investedAmount)}</strong>
        </td>
        <td>
          <span style="font-weight:600; color:var(--text-primary);">${formatCurrency(deal.status === 'Completed' ? deal.actualReturn : deal.expectedReturn)}</span>
        </td>
        <td>
          <span class="metric-profit-tag">+${formatCurrency(finalProfit)}</span>
          <div style="font-size:0.75rem; color:var(--text-muted);">${(deal.roi || 0).toFixed(1)}% ROI</div>
        </td>
        <td>
          <div style="font-size:0.8rem; color:var(--text-secondary);">${formatDate(deal.startDate)}</div>
          <div style="font-size:0.75rem; color: ${isOverdue ? 'var(--accent-rose)' : 'var(--text-muted)'}; font-weight: ${isOverdue ? '600' : 'normal'};">
            Due: ${formatDate(deal.dueDate)}
          </div>
        </td>
        <td>${statusPill}</td>
        <td style="text-align: right;">
          <div style="display:inline-flex; gap:0.4rem;">
            ${deal.status === 'Active' ? `
              <button class="btn btn-sm btn-primary" onclick="openSettleModal('${deal.id}')" title="Mark as returned & settle profit">
                ✓ Settle
              </button>
            ` : ''}
            <button class="btn btn-sm btn-secondary" onclick="openEditModal('${deal.id}')" title="Edit details">
              ✎
            </button>
            <button class="btn btn-sm btn-secondary" onclick="deleteDeal('${deal.id}')" title="Delete record" style="color:var(--accent-rose);">
              ✕
            </button>
          </div>
        </td>
      `;
    }

    tbody.appendChild(tr);
  });
}

function renderApp() {
  renderMetrics();
  renderProfitChart();
  renderPieChart();
  renderTable();
}

// -------------------------------------------------------------
// MODALS & CRUD HANDLERS
// -------------------------------------------------------------
function setModalInvestmentType(type) {
  const radioSelf = document.getElementById("radio-type-self");
  const radioBorrowed = document.getElementById("radio-type-borrowed");
  const lblSelf = document.getElementById("lbl-type-self");
  const lblBorrowed = document.getElementById("lbl-type-borrowed");
  const sectionSelf = document.getElementById("section-fields-self");
  const sectionBorrowed = document.getElementById("section-fields-borrowed");

  if (type === "borrowed") {
    if (radioBorrowed) radioBorrowed.checked = true;
    if (lblSelf) lblSelf.classList.remove("active");
    if (lblBorrowed) lblBorrowed.classList.add("active");
    if (sectionSelf) sectionSelf.style.display = "none";
    if (sectionBorrowed) sectionBorrowed.style.display = "block";
    updateLiveBorrowedCalculations();
  } else {
    if (radioSelf) radioSelf.checked = true;
    if (lblSelf) lblSelf.classList.add("active");
    if (lblBorrowed) lblBorrowed.classList.remove("active");
    if (sectionSelf) sectionSelf.style.display = "block";
    if (sectionBorrowed) sectionBorrowed.style.display = "none";
    updateLiveModalRoi();
  }
}

function updateLiveBorrowedCalculations() {
  const principal = Number(document.getElementById("form-borrowed-principal").value) || 0;
  const gross = Number(document.getElementById("form-borrowed-gross").value) || 0;
  const lenderPay = Number(document.getElementById("form-borrowed-lender-pay").value) || 0;

  const lenderProfit = lenderPay > 0 && principal > 0 ? (lenderPay - principal) : 0;
  const myCut = gross > 0 && lenderPay > 0 ? (gross - lenderPay) : 0;

  const lenderEl = document.getElementById("modal-borrowed-lender-profit");
  const myCutEl = document.getElementById("modal-borrowed-my-cut");

  if (lenderEl) lenderEl.textContent = `${formatCurrency(lenderPay)} (+${formatCurrency(lenderProfit)})`;
  if (myCutEl) myCutEl.textContent = `+${formatCurrency(myCut)}`;
}

function openAddModal() {
  editingId = null;
  document.getElementById("modal-deal-title").textContent = "Add New Investment Cycle";
  document.getElementById("form-title").value = "";
  
  // Reset self fields
  document.getElementById("form-partner").value = appSettings.defaultPartner || "Friend";
  document.getElementById("form-amount").value = "";
  document.getElementById("form-return").value = "";
  document.getElementById("form-roi").value = "15";

  // Reset borrowed fields
  document.getElementById("form-borrowed-lender").value = "";
  document.getElementById("form-borrowed-principal").value = "";
  document.getElementById("form-borrowed-gross").value = "";
  document.getElementById("form-borrowed-lender-pay").value = "";

  document.getElementById("form-start-date").value = new Date().toISOString().split("T")[0];
  document.getElementById("form-due-date").value = getOffsetDateString(30);
  document.getElementById("form-notes").value = "";

  setModalInvestmentType(currentMode);

  document.getElementById("deal-modal").classList.add("open");
}

function openEditModal(id) {
  const deal = investments.find(d => d.id === id);
  if (!deal) return;

  editingId = id;
  document.getElementById("modal-deal-title").textContent = "Edit Investment Cycle";
  document.getElementById("form-title").value = deal.title || "";
  document.getElementById("form-start-date").value = deal.startDate;
  document.getElementById("form-due-date").value = deal.dueDate;
  document.getElementById("form-notes").value = deal.notes || "";

  const dealType = deal.investmentType || "self";
  setModalInvestmentType(dealType);

  if (dealType === "borrowed") {
    document.getElementById("form-borrowed-lender").value = deal.partner || "";
    document.getElementById("form-borrowed-principal").value = deal.investedAmount || "";
    document.getElementById("form-borrowed-gross").value = deal.expectedReturn || "";
    document.getElementById("form-borrowed-lender-pay").value = deal.lenderReturn || "";
    updateLiveBorrowedCalculations();
  } else {
    document.getElementById("form-partner").value = deal.partner || "Friend";
    document.getElementById("form-amount").value = deal.investedAmount || "";
    document.getElementById("form-return").value = deal.expectedReturn || "";
    document.getElementById("form-roi").value = deal.roi || "15";
    updateLiveModalRoi();
  }

  document.getElementById("deal-modal").classList.add("open");
}

function closeModal() {
  document.getElementById("deal-modal").classList.remove("open");
}

function openSettleModal(id) {
  const deal = investments.find(d => d.id === id);
  if (!deal) return;

  settlingId = id;
  const isBorrowed = (deal.investmentType === "borrowed");

  document.getElementById("settle-deal-name").textContent = deal.title;
  document.getElementById("settle-date").value = new Date().toISOString().split("T")[0];

  const inputsSelf = document.getElementById("settle-inputs-self");
  const inputsBorrowed = document.getElementById("settle-inputs-borrowed");

  if (isBorrowed) {
    if (inputsSelf) inputsSelf.style.display = "none";
    if (inputsBorrowed) inputsBorrowed.style.display = "block";

    document.getElementById("settle-lbl-invested").textContent = "Borrowed Principal:";
    document.getElementById("settle-lbl-expected").textContent = "Expected Business Return:";
    document.getElementById("settle-invested-info").textContent = formatCurrency(deal.investedAmount);
    document.getElementById("settle-expected-info").textContent = formatCurrency(deal.expectedReturn);

    document.getElementById("settle-borrowed-actual-gross").value = deal.expectedReturn;
    document.getElementById("settle-borrowed-actual-lender").value = deal.lenderReturn || (deal.expectedReturn - (deal.myProfitCut || 0));
  } else {
    if (inputsSelf) inputsSelf.style.display = "block";
    if (inputsBorrowed) inputsBorrowed.style.display = "none";

    document.getElementById("settle-lbl-invested").textContent = "Principal Invested:";
    document.getElementById("settle-lbl-expected").textContent = "Expected Return:";
    document.getElementById("settle-invested-info").textContent = formatCurrency(deal.investedAmount);
    document.getElementById("settle-expected-info").textContent = formatCurrency(deal.expectedReturn);

    document.getElementById("settle-actual-amount").value = deal.expectedReturn;
  }

  updateSettleProfitPreview();
  document.getElementById("settle-modal").classList.add("open");
}

function closeSettleModal() {
  document.getElementById("settle-modal").classList.remove("open");
}

function updateSettleProfitPreview() {
  const deal = investments.find(d => d.id === settlingId);
  if (!deal) return;

  const isBorrowed = (deal.investmentType === "borrowed");
  const profitLbl = document.getElementById("settle-profit-lbl");
  const profitPreview = document.getElementById("settle-profit-preview");

  if (isBorrowed) {
    const gross = Number(document.getElementById("settle-borrowed-actual-gross").value) || 0;
    const lender = Number(document.getElementById("settle-borrowed-actual-lender").value) || 0;
    const cut = gross - lender;
    const lenderProfit = lender - deal.investedAmount;

    if (profitLbl) profitLbl.textContent = "Your Realized Profit Cut:";
    if (profitPreview) profitPreview.textContent = `+${formatCurrency(cut)} (${formatCurrency(lender)} paid to lender, +${formatCurrency(lenderProfit)} to them)`;
  } else {
    const actualVal = Number(document.getElementById("settle-actual-amount").value) || 0;
    const profit = actualVal - deal.investedAmount;
    const roi = deal.investedAmount > 0 ? ((profit / deal.investedAmount) * 100).toFixed(1) : 0;
    
    if (profitLbl) profitLbl.textContent = "Final Realized Return:";
    if (profitPreview) profitPreview.textContent = `+${formatCurrency(profit)} (${roi}% Net Return)`;
  }
}

function updateLiveModalRoi(sourceField) {
  const amount = Number(document.getElementById("form-amount").value) || 0;
  const returnInput = document.getElementById("form-return");
  const roiInput = document.getElementById("form-roi");

  if (sourceField === "roi") {
    const roi = Number(roiInput.value) || 0;
    if (amount > 0) {
      returnInput.value = Math.round(amount * (1 + roi / 100));
    }
  } else if (sourceField === "return") {
    const retVal = Number(returnInput.value) || 0;
    if (amount > 0 && retVal >= amount) {
      roiInput.value = (((retVal - amount) / amount) * 100).toFixed(2);
    }
  } else if (amount > 0 && !returnInput.value) {
    const roi = Number(roiInput.value) || 15;
    returnInput.value = Math.round(amount * (1 + roi / 100));
  }

  const curReturn = Number(returnInput.value) || 0;
  const profit = Math.max(0, curReturn - amount);
  const finalRoi = amount > 0 ? ((profit / amount) * 100).toFixed(1) : "0.0";

  const calcProfitEl = document.getElementById("modal-calc-profit");
  const calcRoiEl = document.getElementById("modal-calc-roi");

  if (calcProfitEl) calcProfitEl.textContent = `+${formatCurrency(profit)}`;
  if (calcRoiEl) calcRoiEl.textContent = `${finalRoi}%`;
}

// Save Deal
async function handleSaveDeal(e) {
  e.preventDefault();
  const selectedType = document.querySelector('input[name="form-investment-type"]:checked')?.value || "self";
  const title = document.getElementById("form-title").value.trim() || "Dropshipping Investment";
  const startDate = document.getElementById("form-start-date").value;
  const dueDate = document.getElementById("form-due-date").value;
  const notes = document.getElementById("form-notes").value.trim();

  let partner = "";
  let investedAmount = 0;
  let expectedReturn = 0;
  let lenderReturn = null;
  let myProfitCut = null;
  let profit = 0;
  let roi = 0;

  if (selectedType === "borrowed") {
    partner = document.getElementById("form-borrowed-lender").value.trim() || "Lender";
    investedAmount = Number(document.getElementById("form-borrowed-principal").value);
    expectedReturn = Number(document.getElementById("form-borrowed-gross").value);
    lenderReturn = Number(document.getElementById("form-borrowed-lender-pay").value);

    if (!investedAmount || investedAmount <= 0) {
      alert("Please enter a valid borrowed principal amount.");
      return;
    }
    if (!expectedReturn || expectedReturn <= 0) {
      alert("Please enter the total return expected from the dropshipping business.");
      return;
    }
    if (!lenderReturn || lenderReturn < investedAmount) {
      alert("Amount promised to lender must be at least equal to borrowed principal.");
      return;
    }

    myProfitCut = expectedReturn - lenderReturn;
    profit = myProfitCut;
    roi = investedAmount > 0 ? (((expectedReturn - investedAmount) / investedAmount) * 100) : 0;
  } else {
    partner = document.getElementById("form-partner").value.trim() || "Friend";
    investedAmount = Number(document.getElementById("form-amount").value);
    expectedReturn = Number(document.getElementById("form-return").value);

    if (!investedAmount || investedAmount <= 0) {
      alert("Please enter a valid invested amount.");
      return;
    }

    profit = expectedReturn - investedAmount;
    roi = investedAmount > 0 ? ((profit / investedAmount) * 100) : 0;
  }

  const existing = editingId ? investments.find(d => d.id === editingId) : null;

  const dealPayload = {
    id: editingId || ("inv-" + Date.now()),
    investmentType: selectedType,
    userEmail: currentUser ? currentUser.email : "investor@example.com",
    title,
    partner,
    investedAmount,
    expectedReturn,
    lenderReturn: selectedType === "borrowed" ? lenderReturn : null,
    myProfitCut: selectedType === "borrowed" ? myProfitCut : null,
    actualReturn: existing ? existing.actualReturn : null,
    actualLenderReturn: existing ? existing.actualLenderReturn : null,
    profit,
    roi,
    startDate,
    dueDate,
    actualReturnDate: existing ? existing.actualReturnDate : null,
    status: existing ? existing.status : "Active",
    notes
  };

  // Optimistic UI update
  if (editingId) {
    const idx = investments.findIndex(d => d.id === editingId);
    if (idx !== -1) investments[idx] = dealPayload;
  } else {
    investments.unshift(dealPayload);
  }

  saveLocalData();
  renderApp();
  closeModal();
  showToast("Investment saved locally!", "info");

  // Sync to Google Apps Script
  if (currentUser && !currentUser.isDemo && getApiUrl()) {
    try {
      const res = await callBackend("saveInvestment", { deal: dealPayload });
      if (res.success) {
        showToast("Saved to Google Sheets! ✓", "success");
      }
    } catch (err) {
      showToast("Saved locally (offline mode)", "info");
    }
  }
}

// Settle Deal
async function handleConfirmSettlement(e) {
  e.preventDefault();
  const deal = investments.find(d => d.id === settlingId);
  if (!deal) return;

  const actualDate = document.getElementById("settle-date").value;
  const isBorrowed = (deal.investmentType === "borrowed");

  deal.status = "Completed";
  deal.actualReturnDate = actualDate;

  if (isBorrowed) {
    const actualGross = Number(document.getElementById("settle-borrowed-actual-gross").value);
    const actualLender = Number(document.getElementById("settle-borrowed-actual-lender").value);

    deal.actualReturn = actualGross;
    deal.actualLenderReturn = actualLender;
    deal.myProfitCut = actualGross - actualLender;
    deal.profit = deal.myProfitCut;
  } else {
    const actualReturn = Number(document.getElementById("settle-actual-amount").value);
    deal.actualReturn = actualReturn;
    deal.profit = actualReturn - deal.investedAmount;
    deal.roi = deal.investedAmount > 0 ? ((deal.profit / deal.investedAmount) * 100) : 0;
  }

  saveLocalData();
  renderApp();
  closeSettleModal();
  showToast("Deal settled successfully! ✓", "success");

  // Sync to Google Apps Script
  if (currentUser && !currentUser.isDemo && getApiUrl()) {
    try {
      await callBackend("settleInvestment", {
        dealId: deal.id,
        actualReturn: deal.actualReturn,
        actualLenderReturn: deal.actualLenderReturn || null,
        myProfitCut: deal.myProfitCut || null,
        actualReturnDate: actualDate
      });
      showToast("Settlement synced to Google Sheets!", "success");
    } catch (err) {
      console.warn("Could not sync settlement to backend", err);
    }
  }
}

// Delete Deal
async function deleteDeal(id) {
  if (confirm("Are you sure you want to delete this investment record?")) {
    investments = investments.filter(d => d.id !== id);
    saveLocalData();
    renderApp();
    showToast("Investment deleted.");

    if (currentUser && !currentUser.isDemo && getApiUrl()) {
      try {
        await callBackend("deleteInvestment", { dealId: id });
        showToast("Deleted from Google Sheets.");
      } catch (err) {
        console.warn("Could not delete from backend", err);
      }
    }
  }
}

function setTenureDays(days) {
  const startVal = document.getElementById("form-start-date").value || new Date().toISOString().split("T")[0];
  const d = new Date(startVal);
  d.setDate(d.getDate() + days);
  document.getElementById("form-due-date").value = d.toISOString().split("T")[0];
}

// Export CSV
function exportToCsv() {
  const headers = [
    "ID",
    "Type",
    "Cycle / Title",
    "Partner / Lender",
    "Principal Amount",
    "Gross Return",
    "Paid to Lender",
    "Your Net Profit Cut",
    "ROI %",
    "Start Date",
    "Due Date",
    "Settled Date",
    "Status",
    "Notes"
  ];

  const rows = investments.map(d => {
    const isBorrowed = (d.investmentType === "borrowed");
    const gross = d.status === 'Completed' ? (d.actualReturn != null ? d.actualReturn : d.expectedReturn) : d.expectedReturn;
    const lenderPay = isBorrowed ? (d.status === 'Completed' ? (d.actualLenderReturn || d.lenderReturn) : d.lenderReturn) : "";
    const myCut = isBorrowed 
      ? (d.status === 'Completed' ? (d.myProfitCut != null ? d.myProfitCut : (gross - lenderPay)) : (d.myProfitCut || (gross - lenderPay)))
      : d.profit;

    return [
      d.id,
      isBorrowed ? "Borrowed from Others" : "Self Investment",
      `"${(d.title || '').replace(/"/g, '""')}"`,
      `"${(d.partner || '').replace(/"/g, '""')}"`,
      d.investedAmount,
      gross,
      lenderPay,
      myCut,
      (d.roi || 0).toFixed(2),
      d.startDate,
      d.dueDate,
      d.actualReturnDate || "",
      d.status,
      `"${(d.notes || '').replace(/"/g, '""')}"`
    ];
  });

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `dropship_investments_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// -------------------------------------------------------------
// EVENT BINDINGS & OTP DIGIT AUTO-ADVANCE
// -------------------------------------------------------------
function bindEvents() {
  // Mode Switch Tab Bindings
  const tabSelf = document.getElementById("tab-mode-self");
  const tabBorrowed = document.getElementById("tab-mode-borrowed");
  if (tabSelf) tabSelf.addEventListener("click", () => setDashboardMode("self"));
  if (tabBorrowed) tabBorrowed.addEventListener("click", () => setDashboardMode("borrowed"));

  // Auth Form Events
  document.getElementById("auth-email-form").addEventListener("submit", handleSendOtp);
  document.getElementById("auth-otp-form").addEventListener("submit", handleVerifyOtp);
  document.getElementById("btn-resend-otp").addEventListener("click", handleSendOtp);
  document.getElementById("btn-back-to-email").addEventListener("click", resetAuthForms);
  document.getElementById("btn-logout").addEventListener("click", handleLogout);

  // OTP Digits Handling (auto advance & paste)
  const otpInputs = document.querySelectorAll(".otp-digit");
  otpInputs.forEach((input, index) => {
    input.addEventListener("input", (e) => {
      const val = e.target.value.replace(/\D/g, "");
      e.target.value = val ? val[0] : "";
      if (val && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !e.target.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });

    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
      if (pasteData) {
        for (let i = 0; i < otpInputs.length; i++) {
          otpInputs[i].value = pasteData[i] || "";
        }
        const lastIdx = Math.min(pasteData.length, otpInputs.length) - 1;
        if (lastIdx >= 0) otpInputs[lastIdx].focus();
      }
    });
  });

  // Dashboard Modals
  document.getElementById("btn-add-deal").addEventListener("click", openAddModal);
  document.getElementById("modal-close-btn").addEventListener("click", closeModal);
  document.getElementById("modal-cancel-btn").addEventListener("click", closeModal);
  document.getElementById("deal-form").addEventListener("submit", handleSaveDeal);

  // Modal investment type selector
  document.getElementById("radio-type-self")?.addEventListener("change", () => setModalInvestmentType("self"));
  document.getElementById("radio-type-borrowed")?.addEventListener("change", () => setModalInvestmentType("borrowed"));
  document.getElementById("lbl-type-self")?.addEventListener("click", () => setModalInvestmentType("self"));
  document.getElementById("lbl-type-borrowed")?.addEventListener("click", () => setModalInvestmentType("borrowed"));

  // Settlement bindings
  document.getElementById("settle-close-btn").addEventListener("click", closeSettleModal);
  document.getElementById("settle-cancel-btn").addEventListener("click", closeSettleModal);
  document.getElementById("settle-form").addEventListener("submit", handleConfirmSettlement);
  document.getElementById("settle-actual-amount")?.addEventListener("input", updateSettleProfitPreview);
  document.getElementById("settle-borrowed-actual-gross")?.addEventListener("input", updateSettleProfitPreview);
  document.getElementById("settle-borrowed-actual-lender")?.addEventListener("input", updateSettleProfitPreview);

  // Live calculations in modals
  document.getElementById("form-amount")?.addEventListener("input", () => updateLiveModalRoi("amount"));
  document.getElementById("form-return")?.addEventListener("input", () => updateLiveModalRoi("return"));
  document.getElementById("form-roi")?.addEventListener("input", () => updateLiveModalRoi("roi"));

  // Live calculations for borrowed modal
  document.getElementById("form-borrowed-principal")?.addEventListener("input", updateLiveBorrowedCalculations);
  document.getElementById("form-borrowed-gross")?.addEventListener("input", updateLiveBorrowedCalculations);
  document.getElementById("form-borrowed-lender-pay")?.addEventListener("input", updateLiveBorrowedCalculations);

  // Filter tabs
  document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.getAttribute("data-filter");
      renderTable();
    });
  });

  // Search input
  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderTable();
  });

  // Currency selector
  const currencySelect = document.getElementById("currency-select");
  if (currencySelect) {
    currencySelect.value = appSettings.currency;
    currencySelect.addEventListener("change", (e) => {
      appSettings.currency = e.target.value;
      saveLocalData();
      renderApp();
    });
  }

  // CSV Export
  document.getElementById("btn-export-csv").addEventListener("click", exportToCsv);
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Auto init
window.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  checkExistingSession();
});

// Strict Session Cleanup on tab close / refresh
window.addEventListener("pagehide", () => {
  currentUser = null;
  try {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  } catch (e) {}
});
