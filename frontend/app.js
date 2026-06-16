/* AuraTrade - Main Application Controller */

// Default Configurations & State
let state = {
  profiles: {
    "Default User": {
      glassColor: "#121520",
      glassOpacity: "0.45",
      glassBlur: "20px",
      glassBorderOpacity: "0.15",
      blobColor1: "#ff2a5f",
      blobColor2: "#00f0ff",
      blobColor3: "#7000ff",
      blobColor4: "#ffb800",
      lampSpeed: "1.0",
      alpacaApiKey: "",
      alpacaSecretKey: "",
      alpacaLive: false
    }
  },
  activeProfile: "Default User"
};

let currentUser = null;
let isRegisterMode = false;
let perfChart = null;
window.activePositionsCache = [];
let wizTechChart = null;
let wizStochChart = null;
let posTechChart = null;
let posStochChart = null;
let dashTechChart = null;
let dashStochChart = null;
let fullTechChart = null;
let fullStochChart = null;

// Track expanded position details
const expandedPositions = new Set();
const expandedDashboardPositions = new Set();
const activeTicker = "QQQ"; // global tracker for active ticker


// Tooltip dictionary mapping hover-trigger names to detailed descriptions
const tooltips = {
  "Net Asset Value": "<strong>Net Asset Value (NAV)</strong><br><br>The total net worth of this account profile. Calculated as Cash Balance + Market Value of all Long options - Market Value of Short options.",
  "Buying Power": "<strong>Option Buying Power</strong><br><br>The amount of capital available to initiate new options contracts. Options cannot be purchased on margin, so buying power matches your cash assets.",
  "Portfolio Delta (β)": "<strong>Portfolio Delta (Weighted Beta)</strong><br><br>Measures directional exposure. A Delta of +42.85 implies the portfolio acts like owning 42.85 shares of the index. Positives benefit from upside; negatives benefit from downside.",
  "Portfolio Theta (θ)": "<strong>Portfolio Theta</strong><br><br>The total daily time decay of your portfolio. Your assets will lose approximately $184.20 per day if underlying security prices and volatilities remain unchanged."
};

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  // Replace Lucide icons
  lucide.createIcons();

  // Check login state
  checkAuthentication();

  // Bind Auth actions
  initAuthForm();

  // Bind Navigation Tabs
  initNavigation();

  // Bind Custom Theme Sliders
  initThemeSliders();

  // Bind Profile Actions
  initProfileManagement();

  // Set up Hover Layer Tooltip listener
  initHoverTooltips();

  // Initialize expiration dates
  initExpirationDates();

  // Initialize Strategy Wizard
  initStrategyWizard();

  // Initialize Technical Charts & Beginner Baskets
  initTechnicalCharts();
  initBeginnerBaskets();
  initSpreadBudgets();
});

// Authentication Controller
function checkAuthentication() {
  const cachedUser = localStorage.getItem("auratrade_user");
  if (cachedUser) {
    currentUser = cachedUser;
    loadUserProfile(currentUser);
  } else {
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById("authContainer").classList.remove("hidden");
  document.getElementById("appLayout").classList.add("hidden");
}

function hideAuthScreen() {
  document.getElementById("authContainer").classList.add("hidden");
  document.getElementById("appLayout").classList.remove("hidden");
  
  // Render Dashboard graphs & lists
  renderDashboard();
  renderPositions();
  renderOptionChain();
  renderBestBets();

  // Bind options chain triggers
  const fetchChainBtn = document.getElementById("fetchChainBtn");
  const expirationSelect = document.getElementById("expirationSelect");
  const toggleChainModeBtn = document.getElementById("toggleChainModeBtn");
  
  if (fetchChainBtn && !fetchChainBtn.dataset.bound) {
    fetchChainBtn.addEventListener("click", renderOptionChain);
    fetchChainBtn.dataset.bound = "true";
  }
  if (expirationSelect && !expirationSelect.dataset.bound) {
    expirationSelect.addEventListener("change", renderOptionChain);
    expirationSelect.dataset.bound = "true";
  }
  if (toggleChainModeBtn && !toggleChainModeBtn.dataset.bound) {
    toggleChainModeBtn.addEventListener("click", () => {
      const grid = document.getElementById("chainStrategiesGrid");
      const raw = document.getElementById("rawChainContainer");
      if (grid.style.display === "none") {
        grid.style.display = "grid";
        raw.style.display = "none";
        toggleChainModeBtn.textContent = "Show Raw Chain";
      } else {
        grid.style.display = "none";
        raw.style.display = "flex";
        toggleChainModeBtn.textContent = "Show Strategies";
      }
    });
    toggleChainModeBtn.dataset.bound = "true";
  }
}

function initAuthForm() {
  const submitBtn = document.getElementById("authSubmitBtn");
  const toggleBtn = document.getElementById("authToggleBtn");
  const title = document.getElementById("authTitle");

  toggleBtn.addEventListener("click", () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
      title.textContent = "Create Account";
      submitBtn.textContent = "Sign Up";
      toggleBtn.textContent = "Log In";
      document.querySelector(".auth-toggle-text").childNodes[0].textContent = "Already have an account? ";
    } else {
      title.textContent = "Welcome Back";
      submitBtn.textContent = "Log In";
      toggleBtn.textContent = "Sign Up";
      document.querySelector(".auth-toggle-text").childNodes[0].textContent = "Don't have an account? ";
    }
  });

  submitBtn.addEventListener("click", () => {
    const username = document.getElementById("authUsername").value.trim().toLowerCase();
    const password = document.getElementById("authPassword").value;

    if (!username || !password) {
      alert("Please enter a username and password.");
      return;
    }

    const endpoint = isRegisterMode ? "/api/auth/register" : "/api/auth/login";
    
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Authentication request failed");
      return data;
    })
    .then(data => {
      if (isRegisterMode) {
        alert("Registration complete! You can now log in.");
        // Switch mode to login
        toggleBtn.click();
        document.getElementById("authPassword").value = "";
      } else {
        currentUser = data.username;
        localStorage.setItem("auratrade_user", currentUser);
        localStorage.setItem("auratrade_pass_" + currentUser, password);
        state = data.state;
        localStorage.setItem("auratrade_state_" + currentUser, JSON.stringify(state));
        applyProfileSettings(state.activeProfile);
        rebuildProfileSelectors();
        hideAuthScreen();
        showHoverPanel("Access Granted", `Welcome back, <strong>${currentUser}</strong>! Setup is active.`);
      }
    })
    .catch(err => {
      alert(err.message);
    });
  });

  // Logout actions
  document.getElementById("logoutBtn").addEventListener("click", () => {
    if (currentUser) {
      localStorage.removeItem("auratrade_pass_" + currentUser);
      localStorage.removeItem("auratrade_state_" + currentUser);
    }
    localStorage.removeItem("auratrade_user");
    currentUser = null;
    document.getElementById("authUsername").value = "";
    document.getElementById("authPassword").value = "";
    showAuthScreen();
  });
}

// Fetch user profile stats from server
function loadUserProfile(username) {
  fetch(`/api/profiles?username=${encodeURIComponent(username)}`)
  .then(res => {
    if (!res.ok) {
      if (res.status === 404) {
        const cachedState = localStorage.getItem("auratrade_state_" + username);
        const cachedPass = localStorage.getItem("auratrade_pass_" + username);
        if (cachedState && cachedPass) {
          return fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password: cachedPass })
          })
          .then(async regRes => {
            if (!regRes.ok) throw new Error("Auto-registration failed");
            const parsedState = JSON.parse(cachedState);
            return fetch(`/api/profiles?username=${encodeURIComponent(username)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(parsedState)
            })
            .then(syncRes => {
              if (!syncRes.ok) throw new Error("Auto-sync profile failed");
              return parsedState;
            });
          });
        }
        
        localStorage.removeItem("auratrade_user");
        currentUser = null;
        showAuthScreen();
      }
      throw new Error("Could not load user data");
    }
    return res.json();
  })
  .then(data => {
    state = data;
    localStorage.setItem("auratrade_state_" + username, JSON.stringify(state));
    applyProfileSettings(state.activeProfile);
    rebuildProfileSelectors();
    hideAuthScreen();
  })
  .catch(err => {
    console.error("Auto recovery error:", err);
    if (!currentUser) {
      showAuthScreen();
    } else {
      hideAuthScreen();
    }
  });
}

// Navigation Controller
function initNavigation() {
  const navButtons = document.querySelectorAll(".nav-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  navButtons.forEach(btn => {
    if (btn.id === "logoutBtn") return;

    btn.addEventListener("click", () => {
      navButtons.forEach(b => { if(b.id !== "logoutBtn") b.classList.remove("active"); });
      tabContents.forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      const targetTab = btn.getAttribute("data-tab");
      document.getElementById(`tab-${targetTab}`).classList.add("active");
    });
  });
}

// Sliders and Colors bindings to CSS properties
function initThemeSliders() {
  const controls = [
    { id: "glassColor", variable: "--glass-bg" },
    { id: "glassOpacity", variable: "--glass-opacity", outputId: "opacityVal" },
    { id: "glassBlur", variable: "--glass-blur", outputId: "blurVal", suffix: "px" },
    { id: "glassBorderOpacity", variable: "--glass-border-opacity", outputId: "borderVal" },
    { id: "blobColor1", variable: "--blob-1-color" },
    { id: "blobColor2", variable: "--blob-2-color" },
    { id: "blobColor3", variable: "--blob-3-color" },
    { id: "blobColor4", variable: "--blob-4-color" },
    { id: "lampSpeed", variable: "--blob-speed-multiplier", outputId: "speedVal" }
  ];

  controls.forEach(ctrl => {
    const element = document.getElementById(ctrl.id);
    if (!element) return;

    element.addEventListener("input", (e) => {
      const val = e.target.value;
      
      if (ctrl.outputId) {
        document.getElementById(ctrl.outputId).textContent = val + (ctrl.suffix || "");
      }

      state.profiles[state.activeProfile][ctrl.id] = val;
      updateCSSProperty(ctrl.variable, val, ctrl.suffix);
    });
  });

  const apiKeyInput = document.getElementById("alpacaApiKey");
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      const liveCheckbox = document.getElementById("alpacaLive");
      if (liveCheckbox) {
        if (val.startsWith("AK")) {
          liveCheckbox.checked = true;
          document.querySelector(".status-text").textContent = "Alpaca LIVE";
        } else if (val.startsWith("PK")) {
          liveCheckbox.checked = false;
          document.querySelector(".status-text").textContent = "Alpaca Sandbox";
        }
      }
    });
  }

  document.getElementById("saveConfigBtn").addEventListener("click", () => {
    const apiKey = document.getElementById("alpacaApiKey").value.trim();
    let isLive = document.getElementById("alpacaLive").checked;
    if (apiKey.startsWith("AK")) isLive = true;
    if (apiKey.startsWith("PK")) isLive = false;
    
    state.profiles[state.activeProfile].alpacaApiKey = apiKey;
    state.profiles[state.activeProfile].alpacaSecretKey = document.getElementById("alpacaSecretKey").value;
    state.profiles[state.activeProfile].alpacaLive = isLive;

    saveStateToBackend().then(() => {
      const statusText = document.querySelector(".status-text");
      const indicator = document.querySelector(".status-indicator");
      
      statusText.textContent = "Connecting...";
      indicator.style.backgroundColor = "#ffb800";
      indicator.style.boxShadow = "0 0 8px #ffb800";

      setTimeout(() => {
        statusText.textContent = state.profiles[state.activeProfile].alpacaLive ? "Alpaca LIVE" : "Alpaca Sandbox";
        indicator.style.backgroundColor = "#00e676";
        indicator.style.boxShadow = "0 0 8px #00e676";
        showHoverPanel("Config Saved", "Theme and credentials saved successfully for " + state.activeProfile);
      }, 600);
    })
    .catch(err => {
      alert("Error saving configuration: " + err.message);
    });
  });
}

function updateCSSProperty(variable, value, suffix = "") {
  if (variable === "--glass-bg") {
    const rgb = hexToRgb(value);
    if (rgb) {
      document.documentElement.style.setProperty("--glass-bg", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, var(--glass-opacity))`);
    }
  } else {
    document.documentElement.style.setProperty(variable, value + suffix);
  }
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Profile Switcher & Creators
function initProfileManagement() {
  const select = document.getElementById("profileSelect");
  const addBtn = document.getElementById("addProfileBtn");
  const newNameInput = document.getElementById("newProfileName");

  rebuildProfileSelectors();

  select.addEventListener("change", (e) => {
    state.activeProfile = e.target.value;
    applyProfileSettings(state.activeProfile);
    rebuildProfileSelectors();
  });

  addBtn.addEventListener("click", () => {
    const name = newNameInput.value.trim();
    if (!name) return;
    if (state.profiles[name]) {
      alert("Profile already exists!");
      return;
    }

    state.profiles[name] = { ...state.profiles[state.activeProfile] };
    state.activeProfile = name;
    newNameInput.value = "";
    
    saveStateToBackend().then(() => {
      rebuildProfileSelectors();
      applyProfileSettings(name);
      showHoverPanel("Profile Created", `Created and switched to profile: <strong>${name}</strong>`);
    });
  });
}

function rebuildProfileSelectors() {
  const select = document.getElementById("profileSelect");
  const badgeList = document.getElementById("profileBadgeList");
  if(!select || !badgeList) return;
  
  select.innerHTML = "";
  badgeList.innerHTML = "";

  Object.keys(state.profiles).forEach(pName => {
    const option = document.createElement("option");
    option.value = pName;
    option.textContent = pName;
    option.selected = (pName === state.activeProfile);
    select.appendChild(option);

    const badge = document.createElement("div");
    badge.className = `profile-badge ${pName === state.activeProfile ? "active" : ""}`;
    badge.innerHTML = `
      <span>${pName}</span>
      ${Object.keys(state.profiles).length > 1 ? `<span class="delete-profile" data-name="${pName}">&times;</span>` : ""}
    `;
    
    badge.addEventListener("click", (e) => {
      if (e.target.classList.contains("delete-profile")) {
        e.stopPropagation();
        const toDelete = e.target.getAttribute("data-name");
        delete state.profiles[toDelete];
        if (state.activeProfile === toDelete) {
          state.activeProfile = Object.keys(state.profiles)[0];
        }
        saveStateToBackend().then(() => {
          rebuildProfileSelectors();
          applyProfileSettings(state.activeProfile);
        });
      } else {
        state.activeProfile = pName;
        applyProfileSettings(pName);
        rebuildProfileSelectors();
      }
    });
    badgeList.appendChild(badge);
  });
}

function applyProfileSettings(profileName) {
  const settings = state.profiles[profileName];
  if (!settings) return;

  document.getElementById("glassColor").value = settings.glassColor;
  document.getElementById("glassOpacity").value = settings.glassOpacity;
  document.getElementById("opacityVal").textContent = settings.glassOpacity;
  
  const blurVal = parseInt(settings.glassBlur);
  document.getElementById("glassBlur").value = blurVal;
  document.getElementById("blurVal").textContent = settings.glassBlur;

  document.getElementById("glassBorderOpacity").value = settings.glassBorderOpacity;
  document.getElementById("borderVal").textContent = settings.glassBorderOpacity;

  document.getElementById("blobColor1").value = settings.blobColor1;
  document.getElementById("blobColor2").value = settings.blobColor2;
  document.getElementById("blobColor3").value = settings.blobColor3;
  document.getElementById("blobColor4").value = settings.blobColor4;
  
  document.getElementById("lampSpeed").value = settings.lampSpeed;
  document.getElementById("speedVal").textContent = settings.lampSpeed;

  const apiKeyVal = settings.alpacaApiKey || "";
  if (apiKeyVal.startsWith("AK")) {
    settings.alpacaLive = true;
  } else if (apiKeyVal.startsWith("PK")) {
    settings.alpacaLive = false;
  }
  
  document.getElementById("alpacaApiKey").value = apiKeyVal;
  document.getElementById("alpacaSecretKey").value = settings.alpacaSecretKey || "";
  document.getElementById("alpacaLive").checked = settings.alpacaLive || false;

  updateCSSProperty("--glass-bg", settings.glassColor);
  updateCSSProperty("--glass-opacity", settings.glassOpacity);
  updateCSSProperty("--glass-blur", settings.glassBlur);
  updateCSSProperty("--glass-border-opacity", settings.glassBorderOpacity);

  updateCSSProperty("--blob-1-color", settings.blobColor1);
  updateCSSProperty("--blob-2-color", settings.blobColor2);
  updateCSSProperty("--blob-3-color", settings.blobColor3);
  updateCSSProperty("--blob-4-color", settings.blobColor4);
  updateCSSProperty("--blob-speed-multiplier", settings.lampSpeed);

  const statusText = document.querySelector(".status-text");
  if(statusText) {
    statusText.textContent = settings.alpacaLive ? "Alpaca LIVE" : "Alpaca Sandbox";
  }
}

// Hover Info Panel / Tooltips (Top Layer)
function initHoverTooltips() {
  const panel = document.getElementById("hoverInfoPanel");
  const closeBtn = document.getElementById("hoverCloseBtn");

  document.querySelectorAll(".metric-card").forEach(card => {
    card.addEventListener("mouseenter", (e) => {
      const metricLabel = card.querySelector(".metric-label").textContent.trim();
      const content = tooltips[metricLabel] || "Options Trading Parameter Details.";
      showHoverPanel(metricLabel, content);
    });
  });

  closeBtn.addEventListener("click", () => {
    panel.classList.remove("visible");
  });
}

function showHoverPanel(title, htmlContent) {
  const panel = document.getElementById("hoverInfoPanel");
  const panelBody = document.getElementById("hoverBody");
  const panelTitle = document.getElementById("hoverTitle");

  panelTitle.innerHTML = title;
  panelBody.innerHTML = htmlContent;
  panel.classList.add("visible");
}

// Data Rendering (Dashboard Stats, Position Matrix, Options Chain)
function renderDashboard() {
  if (!currentUser || !state.activeProfile) return;
  fetch(`/api/account?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(accountData => {
    const currentEquity = parseFloat(accountData.equity) || 0.0;
    document.getElementById("navValue").textContent = `$${accountData.equity}`;
    document.getElementById("buyingPower").textContent = `$${accountData.buying_power}`;
    
    const indicator = document.querySelector(".status-indicator");
    const statusText = document.querySelector(".status-text");
    if(indicator && statusText) {
      if (accountData.is_mock) {
        indicator.style.backgroundColor = "#ffb800"; 
        indicator.style.boxShadow = "0 0 8px #ffb800";
        statusText.textContent = "Offline / Sandbox Demo";
      } else {
        indicator.style.backgroundColor = "#00e676"; 
        indicator.style.boxShadow = "0 0 8px #00e676";
        statusText.textContent = state.profiles[state.activeProfile].alpacaLive ? "Alpaca LIVE" : "Alpaca Sandbox";
      }
    }

    fetch(`/api/portfolio/history?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
    .then(res => res.json())
    .then(historyData => {
      const canvas = document.getElementById("performanceChart");
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (perfChart) perfChart.destroy();

      let labels = [];
      let dataPoints = [];

      if (historyData.timestamp && historyData.timestamp.length > 0) {
        labels = historyData.timestamp.map(ts => {
          const d = new Date(ts * 1000);
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        });
        dataPoints = historyData.equity;
      } else {
        labels = ["Start", "Today"];
        dataPoints = [currentEquity, currentEquity];
      }

      perfChart = new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [{
            label: "Net Value ($)",
            data: dataPoints,
            borderColor: "#00f0ff",
            backgroundColor: "rgba(0, 240, 255, 0.05)",
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { grid: { color: "rgba(255, 255, 255, 0.05)" }, ticks: { color: "rgba(255,255,255,0.6)" } },
            y: { grid: { color: "rgba(255, 255, 255, 0.05)" }, ticks: { color: "rgba(255,255,255,0.6)" } }
          }
        }
      });
    })
    .catch(err => console.error("Error drawing portfolio history chart:", err));
  })
  .catch(err => console.error("Error fetching account balance:", err));

  const strategySummary = document.getElementById("strategySummary");
  if (strategySummary) {
    fetch(`/api/positions?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
    .then(res => res.json())
    .then(positions => {
      window.activePositionsCache = positions;
      let totalPnL = 0;
      positions.forEach(pos => {
        const val = parseFloat(pos.pnl.replace(/[^\d.-]/g, '')) || 0;
        totalPnL += val;
      });
      const pnlEl = document.getElementById("navPnL");
      if (pnlEl) {
        pnlEl.textContent = (totalPnL >= 0 ? '+' : '') + `$${totalPnL.toFixed(2)} Live PnL`;
        pnlEl.className = `metric-change ${totalPnL >= 0 ? 'positive' : 'negative'}`;
      }

      if (positions.length === 0) {
        strategySummary.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 16px; font-size: 13px;">No active option/stock positions.</div>`;
        return;
      }
      
      strategySummary.innerHTML = positions.map(pos => {
        const posKey = `${pos.ticker}_${pos.strike}_${pos.type}`;
        const isExpanded = expandedDashboardPositions.has(posKey);
        
        const closeBtnHtml = pos.expiry_yymmdd ? `
          <button class="action-btn-close" onclick="event.stopPropagation(); handleClosePosition('${pos.ticker}', '${pos.type}', \`${pos.strike}\`, ${pos.qty}, '${pos.expiry_yymmdd}')">Close</button>
        ` : '';

        const greeksHtml = isExpanded ? `
          <div class="strategy-greeks-detail" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 11px; text-align: center;">
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 9px; text-transform: uppercase;">Net Delta</span>
              <strong style="color: var(--accent-neutral);">${pos.delta}</strong>
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 9px; text-transform: uppercase;">Net Gamma</span>
              <strong style="color: var(--accent-neutral);">${pos.gamma}</strong>
            </div>
            <div>
              <span style="color: var(--text-muted); display: block; font-size: 9px; text-transform: uppercase;">Net Theta</span>
              <strong style="color: ${parseFloat(pos.theta) < 0 ? 'var(--accent-negative)' : 'var(--accent-positive)'};">${pos.theta}</strong>
            </div>
          </div>
          ${renderTugOfWarMeter(pos)}
        ` : '';

        return `
          <div class="strategy-item hover-trigger" style="cursor: pointer; display: block;" onclick="toggleDashboardPosition('${posKey}')">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <div class="strategy-info">
                <span class="strategy-title">${pos.ticker} ${pos.strike !== "-" ? "$" + pos.strike : ""} ${pos.type}</span>
                <span class="strategy-meta">Expires ${pos.exp} | Qty: ${pos.qty}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="strategy-pnl ${pos.status}">${pos.pnl}</span>
                ${closeBtnHtml}
              </div>
            </div>
            ${greeksHtml}
          </div>
        `;
      }).join("");
    })
    .catch(err => {
      strategySummary.innerHTML = `<div style="text-align: center; color: var(--accent-negative); padding: 16px; font-size: 13px;">Failed to fetch active strategies.</div>`;
    });
  }
}

function renderPositions(useCache = false) {
  const tbody = document.getElementById("positionsTableBody");
  if (!tbody) return;

  if (!currentUser || !state.activeProfile) return;

  const performRender = (openOrders, positions) => {
    if (!Array.isArray(positions)) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--accent-negative); padding: 24px;">Failed to fetch active positions: ${positions && positions.detail ? positions.detail : "Invalid server response"}</td></tr>`;
      return;
    }
    if (positions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 24px;">No active option/stock positions found.</td></tr>`;
      return;
    }
    
    // Save focused element ID, cursor selection, and scroll positions to prevent jumpiness on mobile refresh
    const activeEl = document.activeElement;
    const activeElId = activeEl ? activeEl.id : null;
    const activeElVal = activeEl && activeEl.tagName === 'INPUT' ? activeEl.value : null;
    let activeElSelStart = null;
    let activeElSelEnd = null;
    if (activeEl && activeEl.tagName === 'INPUT') {
      try {
        activeElSelStart = activeEl.selectionStart;
        activeElSelEnd = activeEl.selectionEnd;
      } catch (e) {}
    }
    
    const scrollStates = {};
    const inputs = tbody.querySelectorAll('input[type="number"]');
    inputs.forEach(inp => {
      scrollStates[inp.id] = inp.value;
    });

    tbody.innerHTML = positions.map(pos => {
      const posKey = `${pos.ticker}_${pos.strike}_${pos.type}`;
      const isExpanded = expandedPositions.has(posKey);
      
      const closeBtnHtml = pos.expiry_yymmdd ? `
        <button class="action-btn-close" onclick="event.stopPropagation(); handleClosePosition('${pos.ticker}', '${pos.type}', \`${pos.strike}\`, ${pos.qty}, '${pos.expiry_yymmdd}')">Close</button>
      ` : '-';
      
      // Strike display: default to strike, but override with breakeven price if available
      let strikeDisplay = pos.strike !== "-" ? "$" + pos.strike : "-";
      if (pos.breakevens && pos.breakevens.length > 0) {
        strikeDisplay = pos.breakevens.map(be => "$" + parseFloat(be.price).toFixed(2)).join(" / ");
      }

      // Credit/Debit Badge next to the strike price
      let CD_badge = '';
      if (pos.is_credit !== undefined) {
        const label = pos.is_credit ? 'C' : 'D';
        let colorClass = 'neutral';
        const posTypeLower = (pos.type || "").toLowerCase();
        const isBull = posTypeLower.includes("bull") || 
                       (posTypeLower === "call" && pos.qty > 0) || 
                       (posTypeLower === "put" && pos.qty < 0);
        const isBear = posTypeLower.includes("bear") || 
                       (posTypeLower === "put" && pos.qty > 0) || 
                       (posTypeLower === "call" && pos.qty < 0);
        if (isBull) {
          colorClass = 'positive';
        } else if (isBear) {
          colorClass = 'negative';
        }
        CD_badge = ` <span class="credit-debit-badge ${colorClass}">${label}</span>`;
      }

      const mainRowHtml = `
        <tr style="cursor: pointer;" onclick="toggleTablePosition('${posKey}')">
          <td><strong>${pos.ticker}</strong></td>
          <td>${strikeDisplay}${CD_badge}</td>
          <td>${pos.qty}</td>
          <td>$${pos.avg}</td>
          <td>$${pos.mark}</td>
          <td class="${parseFloat(pos.delta) >= 0 ? 'positive' : 'negative'}">${pos.delta}</td>
          <td class="${parseFloat(pos.theta) >= 0 ? 'positive' : 'negative'}">${pos.theta}</td>
          <td class="${pos.status}">${pos.pnl}</td>
          <td>${closeBtnHtml}</td>
        </tr>
      `;

      const tpConfigHtml = pos.expiry_yymmdd ? `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px; max-width: 320px; background: rgba(255, 255, 255, 0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <span style="font-size: 11px; font-weight: 700; color: var(--accent-neutral); text-transform: uppercase;">Set Good-Til-Cancelled Take Profit:</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span style="font-size: 13px; color: var(--text-muted);">$</span>
            <input type="number" id="tp_input_${posKey}" placeholder="e.g. 0.80" step="0.05" min="0.01" style="flex: 1; padding: 6px 10px; font-size: 13px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: var(--text-main); outline: none;">
            <button class="primary-btn" style="margin: 0; padding: 6px 12px; font-size: 12px; font-weight: 600;" onclick="event.stopPropagation(); submitTPTarget('${pos.ticker}', '${pos.type}', \`${pos.strike}\`, ${pos.qty}, '${pos.expiry_yymmdd}', '${posKey}')">Submit</button>
          </div>
        </div>
      ` : '';

      const detailRowHtml = isExpanded ? `
        <tr class="position-details-row" style="background: rgba(255, 255, 255, 0.02); backdrop-filter: blur(5px);">
          <td colspan="9" style="padding: 16px 24px; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; flex-direction: column; gap: 16px; max-width: 600px;">
              <div style="display: flex; gap: 16px 40px; align-items: center; flex-wrap: wrap;">
                <span style="font-size: 11px; font-weight: 700; color: var(--accent-neutral); text-transform: uppercase; letter-spacing: 0.5px;">Combined Position Greeks:</span>
                <div style="display: flex; gap: 16px 24px; flex-wrap: wrap;">
                  <div style="font-size: 13px;">
                    <span style="color: var(--text-muted); font-size: 11px; margin-right: 6px;">Delta:</span>
                    <strong>${pos.delta}</strong>
                  </div>
                  <div style="font-size: 13px;">
                    <span style="color: var(--text-muted); font-size: 11px; margin-right: 6px;">Gamma:</span>
                    <strong>${pos.gamma}</strong>
                  </div>
                  <div style="font-size: 13px;">
                    <span style="color: var(--text-muted); font-size: 11px; margin-right: 6px;">Theta:</span>
                    <strong style="color: ${parseFloat(pos.theta) < 0 ? 'var(--accent-negative)' : 'var(--accent-positive)'};">${pos.theta}</strong>
                  </div>
                </div>
              </div>
              ${renderTugOfWarMeter(pos)}
              ${tpConfigHtml}
            </div>
          </td>
        </tr>
      ` : '';
      
      return mainRowHtml + detailRowHtml;
    }).join("");

    // Render Open Orders card
    const openOrdersTbody = document.getElementById("openOrdersTableBody");
    if (openOrdersTbody) {
      if (!Array.isArray(openOrders) || openOrders.length === 0) {
        openOrdersTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No open take profit orders.</td></tr>`;
      } else {
        openOrdersTbody.innerHTML = openOrders.map(ord => {
          const cancelBtnHtml = `
            <button class="action-btn-close" style="background: var(--accent-negative); margin: 0; padding: 6px 12px; font-size: 11px;" onclick="event.stopPropagation(); handleCancelTPOrder('${ord.id}')">Cancel</button>
          `;
          const displaySymbol = ord.symbol || (ord.legs && ord.legs.length > 0 ? ord.legs[0].symbol.split(/\d/)[0] + ' Spread' : 'Spread Order');
          return `
            <tr>
              <td><strong>${displaySymbol}</strong><span style="font-size:10px; color:var(--text-muted); display:block; margin-top:2px;">ID: ${ord.id.substring(0,8)}...</span></td>
              <td>Limit Take Profit</td>
              <td>${ord.qty}</td>
              <td>$${parseFloat(ord.limit_price || 0.0).toFixed(2)}</td>
              <td>${cancelBtnHtml}</td>
            </tr>
          `;
        }).join("");
      }
    }

    // Restore stored input values
    Object.keys(scrollStates).forEach(id => {
      const inp = tbody.querySelector(`#${id}`);
      if (inp && scrollStates[id] !== undefined) {
        inp.value = scrollStates[id];
      }
    });

    // Restore focus and cursor positions to prevent layout shifts on update ticks
    if (activeElId) {
      const restoredEl = tbody.querySelector(`#${activeElId}`);
      if (restoredEl) {
        if (activeElVal !== null) {
          restoredEl.value = activeElVal;
        }
        restoredEl.focus();
        if (activeElSelStart !== null && activeElSelEnd !== null && restoredEl.setSelectionRange) {
          try {
            restoredEl.setSelectionRange(activeElSelStart, activeElSelEnd);
          } catch (e) {}
        }
      }
    }
  };

  if (useCache && window.activePositionsCache && window.openOrdersCache) {
    performRender(window.openOrdersCache, window.activePositionsCache);
    return;
  }

  // Fetch open orders first to cross reference Take Profit status
  fetch(`/api/positions/orders?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(openOrders => {
    window.openOrdersCache = openOrders;
    fetch(`/api/positions?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
    .then(res => res.json())
    .then(positions => {
      window.activePositionsCache = positions;
      performRender(openOrders, positions);
    })
    .catch(err => {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--accent-negative); padding: 24px;">Failed to fetch active positions.</td></tr>`;
    });
  })
  .catch(err => {
    console.error("Error fetching open orders: ", err);
  });
}

window.submitTPTarget = function(ticker, type, strike, qty, expiry_yymmdd, posKey) {
  const inputEl = document.getElementById(`tp_input_${posKey}`);
  if (!inputEl || !inputEl.value) {
    alert("Please enter a valid price target.");
    return;
  }
  const tpVal = parseFloat(inputEl.value);
  if (isNaN(tpVal) || tpVal <= 0) {
    alert("Please enter a positive limit price.");
    return;
  }

  const payload = {
    username: currentUser,
    profile: state.activeProfile,
    ticker: ticker,
    type: type,
    strike: strike,
    qty: parseInt(qty) || 1,
    expiry_yymmdd: expiry_yymmdd,
    tp_price: tpVal
  };

  fetch('/api/positions/update_tp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(data => { throw new Error(data.detail || 'Failed to submit profit target limit.'); });
    }
    return res.json();
  })
  .then(data => {
    alert(data.message || 'Take Profit limit order submitted.');
    renderPositions();
  })
  .catch(err => alert(`Error: ${err.message}`));
};

window.handleCancelTPOrder = function(orderId) {
  if (!confirm("Are you sure you want to cancel this Take Profit order?")) return;

  const payload = {
    username: currentUser,
    profile: state.activeProfile,
    order_id: orderId
  };

  fetch('/api/positions/cancel_order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(data => { throw new Error(data.detail || 'Failed to cancel order.'); });
    }
    return res.json();
  })
  .then(data => {
    alert(data.message || 'Order cancelled.');
    renderPositions();
  })
  .catch(err => alert(`Error: ${err.message}`));
};

function findStrikeByDelta(strikes, targetDelta, type) {
  if (!strikes || strikes.length === 0) return null;
  let closest = null;
  let minDiff = Infinity;
  for (const s of strikes) {
    const delta = parseFloat(type === 'CALL' ? s.callDelta : s.putDelta);
    if (isNaN(delta)) continue;
    const diff = Math.abs(delta - targetDelta);
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }
  return closest;
}

function renderOptionChain() {
  const tickerInput = document.getElementById("underlyingTicker");
  const ticker = tickerInput ? tickerInput.value.trim().toUpperCase() : "AAPL";
  const callsBody = document.getElementById("callsTableBody");
  const putsBody = document.getElementById("putsTableBody");
  const strategiesGrid = document.getElementById("chainStrategiesGrid");
  if(!callsBody || !putsBody || !strategiesGrid) return;

  const expirySelect = document.getElementById("expirationSelect");
  
  if(expirySelect && expirySelect.children.length === 0) {
    expirySelect.innerHTML = `
      <option>June 12, 2026 (8 Days)</option>
      <option>June 19, 2026 (15 Days)</option>
      <option>July 17, 2026 (43 Days)</option>
    `;
  }
  const expiry = expirySelect ? expirySelect.value : "June 19, 2026 (15 Days)";

  callsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">Loading calls...</td></tr>`;
  putsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">Loading puts...</td></tr>`;
  strategiesGrid.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px; grid-column: span 3;">Generating optimal option spread setups...</div>`;

  fetch(`/api/options/chain?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(expiry)}&username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(data => {
    const headerText = document.querySelector("#tab-options p");
    if (headerText) {
      headerText.innerHTML = `Analyze strikes, premiums, and execute trades for <strong>${data.ticker}</strong> (Current Stock Price: <strong>$${data.underlyingPrice}</strong>).`;
    }

    if (!data.strikes || data.strikes.length === 0) {
      callsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">No contracts found for ${data.ticker}.</td></tr>`;
      putsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">No contracts found for ${data.ticker}.</td></tr>`;
      strategiesGrid.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px; grid-column: span 3;">No spreads could be calculated.</div>`;
      return;
    }

    callsBody.innerHTML = data.strikes.map(s => `
      <tr class="trade-row" onclick="selectStrike('CALL', '${s.strike}', '${s.callAsk}')">
        <td>$${s.callBid}</td>
        <td>$${s.callAsk}</td>
        <td class="positive">+${s.callDelta}</td>
        <td><strong>$${s.strike}</strong></td>
      </tr>
    `).join("");

    putsBody.innerHTML = data.strikes.map(s => `
      <tr class="trade-row" onclick="selectStrike('PUT', '${s.strike}', '${s.putAsk}')">
        <td><strong>$${s.strike}</strong></td>
        <td class="negative">${s.putDelta}</td>
        <td>$${s.putBid}</td>
        <td>$${s.putAsk}</td>
      </tr>
    `).join("");

    const checkWidthAvailable = (w) => {
      for (let i = 0; i < data.strikes.length; i++) {
        const s1 = parseFloat(data.strikes[i].strike);
        for (let j = i + 1; j < data.strikes.length; j++) {
          const s2 = parseFloat(data.strikes[j].strike);
          if (Math.abs(Math.abs(s1 - s2) - w) < 0.02) {
            return true;
          }
        }
      }
      return false;
    };

    const chainPresetBtns = document.querySelectorAll("#spreadBudgetsGroup .budget-preset-btn");
    chainPresetBtns.forEach(btn => {
      const budgetVal = parseFloat(btn.getAttribute("data-budget")) / 100;
      if (checkWidthAvailable(budgetVal)) {
        btn.classList.remove("width-unavailable");
      } else {
        btn.classList.add("width-unavailable");
      }
    });

    const spreadLimitInput = document.getElementById("spreadLimitInput");
    const targetWidth = parseFloat(spreadLimitInput ? spreadLimitInput.value : 1.0) || 1.0;

    function findStrikeWithWidth(strikes, shortStrikeVal, width, direction, type) {
      const targetStrikeVal = shortStrikeVal + (direction * width);
      let closest = null;
      let minDiff = Infinity;
      for (const s of strikes) {
        const val = parseFloat(s.strike);
        if (Math.abs(val - shortStrikeVal) < 0.02) continue;
        const diff = Math.abs(val - targetStrikeVal);
        if (diff < minDiff) {
          minDiff = diff;
          closest = s;
        }
      }
      return closest;
    }

    const bpSellPut = findStrikeByDelta(data.strikes, -0.25, 'PUT');
    const bpBuyPut = bpSellPut ? findStrikeWithWidth(data.strikes, parseFloat(bpSellPut.strike), targetWidth, -1, 'PUT') : null;

    const bcSellCall = findStrikeByDelta(data.strikes, 0.25, 'CALL');
    const bcBuyCall = bcSellCall ? findStrikeWithWidth(data.strikes, parseFloat(bcSellCall.strike), targetWidth, 1, 'CALL') : null;

    const dbBuyCall = findStrikeByDelta(data.strikes, 0.50, 'CALL');
    const dbSellCall = dbBuyCall ? findStrikeWithWidth(data.strikes, parseFloat(dbBuyCall.strike), targetWidth, 1, 'CALL') : null;

    const dbBuyPut = findStrikeByDelta(data.strikes, -0.50, 'PUT');
    const dbSellPut = dbBuyPut ? findStrikeWithWidth(data.strikes, parseFloat(dbBuyPut.strike), targetWidth, -1, 'PUT') : null;

    const atmCall = findStrikeByDelta(data.strikes, 0.50, 'CALL');
    const atmPut = findStrikeByDelta(data.strikes, -0.50, 'PUT');    
    
    function isWidthExact(shortStrike, buyStrike, targetWidth) {
      if (!shortStrike || !buyStrike) return false;
      const actualWidth = Math.abs(parseFloat(shortStrike.strike) - parseFloat(buyStrike.strike));
      return Math.abs(actualWidth - targetWidth) < 0.02;
    }

    const cards = [];

    if (bpSellPut && bpBuyPut) {
      const sellPutPrem = parseFloat(bpSellPut.putBid);
      const buyPutPrem = parseFloat(bpBuyPut.putAsk);
      const netCredit = Math.max(0.05, sellPutPrem - buyPutPrem);
      const width = Math.abs(parseFloat(bpSellPut.strike) - parseFloat(bpBuyPut.strike));
      const collateral = width * 100;
      const maxProfit = netCredit * 100;
      const maxRisk = Math.max(5, (width - netCredit) * 100);
      const winProb = Math.round((1 - Math.abs(parseFloat(bpSellPut.putDelta))) * 100);

      cards.push({
        title: "Bull Put Credit Spread",
        type: "Bull Put Spread",
        strikes: `Sell ${bpSellPut.strike}P / Buy ${bpBuyPut.strike}P ($${width.toFixed(2)} wide)`,
        desc: "Bullish to neutral. Earn credit from time decay. Max profit is achieved if stock stays above the short put strike.",
        winProb: `${winProb}%`,
        maxProfit: `$${maxProfit.toFixed(2)}`,
        maxLoss: `$${maxRisk.toFixed(2)}`,
        premium: `+$${netCredit.toFixed(2)}`,
        collateral: `$${collateral.toFixed(0)}`,
        legs: `Sell ${bpSellPut.strike}P / Buy ${bpBuyPut.strike}P`,
        widthExact: isWidthExact(bpSellPut, bpBuyPut, targetWidth)
      });
    }

    if (bcSellCall && bcBuyCall) {
      const sellCallPrem = parseFloat(bcSellCall.callBid);
      const buyCallPrem = parseFloat(bcBuyCall.callAsk);
      const netCredit = Math.max(0.05, sellCallPrem - buyCallPrem);
      const width = Math.abs(parseFloat(bcBuyCall.strike) - parseFloat(bcSellCall.strike));
      const collateral = width * 100;
      const maxProfit = netCredit * 100;
      const maxRisk = Math.max(5, (width - netCredit) * 100);
      const winProb = Math.round((1 - Math.abs(parseFloat(bcSellCall.callDelta))) * 100);

      cards.push({
        title: "Bear Call Credit Spread",
        type: "Bear Call Spread",
        strikes: `Sell ${bcSellCall.strike}C / Buy ${bcBuyCall.strike}C ($${width.toFixed(2)} wide)`,
        desc: "Bearish to neutral. Earn credit from time decay. Max profit is achieved if stock stays below the short call strike.",
        winProb: `${winProb}%`,
        maxProfit: `$${maxProfit.toFixed(2)}`,
        maxLoss: `$${maxRisk.toFixed(2)}`,
        premium: `+$${netCredit.toFixed(2)}`,
        collateral: `$${collateral.toFixed(0)}`,
        legs: `Sell ${bcSellCall.strike}C / Buy ${bcBuyCall.strike}C`,
        widthExact: isWidthExact(bcSellCall, bcBuyCall, targetWidth)
      });
    }

    if (dbBuyCall && dbSellCall) {
      const buyCallPrem = parseFloat(dbBuyCall.callAsk);
      const sellCallPrem = parseFloat(dbSellCall.callBid);
      const netDebit = Math.max(0.05, buyCallPrem - sellCallPrem);
      const width = Math.abs(parseFloat(dbSellCall.strike) - parseFloat(dbBuyCall.strike));
      const maxProfit = Math.max(5, (width - netDebit) * 100);
      const maxRisk = netDebit * 100;
      const winProb = Math.round(Math.abs(parseFloat(dbBuyCall.callDelta)) * 100);

      cards.push({
        title: "Bull Call Debit Spread",
        type: "Bull Call Spread",
        strikes: `Buy ${dbBuyCall.strike}C / Sell ${dbSellCall.strike}C ($${width.toFixed(2)} wide)`,
        desc: "Strongly bullish. Leverage price gains with defined risk. Max profit occurs if stock ends above the short call strike.",
        winProb: `${winProb}%`,
        maxProfit: `$${maxProfit.toFixed(2)}`,
        maxLoss: `$${maxRisk.toFixed(2)}`,
        premium: `-$${netDebit.toFixed(2)}`,
        collateral: `$0 (Debit Paid)`,
        legs: `Buy ${dbBuyCall.strike}C / Sell ${dbSellCall.strike}C`,
        widthExact: isWidthExact(dbBuyCall, dbSellCall, targetWidth)
      });
    }

    if (dbBuyPut && dbSellPut) {
      const buyPutPrem = parseFloat(dbBuyPut.putAsk);
      const sellPutPrem = parseFloat(dbSellPut.putBid);
      const netDebit = Math.max(0.05, buyPutPrem - sellPutPrem);
      const width = Math.abs(parseFloat(dbSellPut.strike) - parseFloat(dbBuyPut.strike));
      const maxProfit = Math.max(5, (width - netDebit) * 100);
      const maxRisk = netDebit * 100;
      const winProb = Math.round(Math.abs(parseFloat(dbBuyPut.putDelta)) * 100);

      cards.push({
        title: "Bear Put Debit Spread",
        type: "Bear Put Spread",
        strikes: `Buy ${dbBuyPut.strike}P / Sell ${dbSellPut.strike}P ($${width.toFixed(2)} wide)`,
        desc: "Strongly bearish. Profit from downward moves with defined risk. Max profit occurs if stock ends below the short put strike.",
        winProb: `${winProb}%`,
        maxProfit: `$${maxProfit.toFixed(2)}`,
        maxLoss: `$${maxRisk.toFixed(2)}`,
        premium: `-$${netDebit.toFixed(2)}`,
        collateral: `$0 (Debit Paid)`,
        legs: `Buy ${dbBuyPut.strike}P / Sell ${dbSellPut.strike}P`,
        widthExact: isWidthExact(dbBuyPut, dbSellPut, targetWidth)
      });
    }

    if (bpSellPut && bpBuyPut && bcSellCall && bcBuyCall) {
      const putCredit = parseFloat(bpSellPut.putBid) - parseFloat(bpBuyPut.putAsk);
      const callCredit = parseFloat(bcSellCall.callBid) - parseFloat(bcBuyCall.callAsk);
      const totalCredit = Math.max(0.10, putCredit + callCredit);
      const putWidth = Math.abs(parseFloat(bpSellPut.strike) - parseFloat(bpBuyPut.strike));
      const callWidth = Math.abs(parseFloat(bcBuyCall.strike) - parseFloat(bcSellCall.strike));
      const maxWidth = Math.max(putWidth, callWidth);
      const collateral = maxWidth * 100;
      const maxProfit = totalCredit * 100;
      const maxRisk = Math.max(5, (maxWidth - totalCredit) * 100);
      const winProb = Math.round((1 - Math.abs(parseFloat(bpSellPut.putDelta)) - Math.abs(parseFloat(bcSellCall.callDelta))) * 100);

      cards.push({
        title: "Iron Condor Spread",
        type: "Iron Condor",
        strikes: `Sell ${bcSellCall.strike}C/Buy ${bcBuyCall.strike}C + Sell ${bpSellPut.strike}P/Buy ${bpBuyPut.strike}P`,
        desc: "Neutral setup. Capitalize on sideways trading range. High win probability as time value decays on both sides.",
        winProb: `${winProb}%`,
        maxProfit: `$${maxProfit.toFixed(2)}`,
        maxLoss: `$${maxRisk.toFixed(2)}`,
        premium: `+$${totalCredit.toFixed(2)}`,
        collateral: `$${collateral.toFixed(0)}`,
        legs: `Sell ${bcSellCall.strike}C/Buy ${bcBuyCall.strike}C + Sell ${bpSellPut.strike}P/Buy ${bpBuyPut.strike}P`,
        widthExact: isWidthExact(bpSellPut, bpBuyPut, targetWidth) && isWidthExact(bcSellCall, bcBuyCall, targetWidth)
      });
    }

    strategiesGrid.innerHTML = cards.map(c => `
      <div class="best-bet-item hover-trigger ${c.widthExact ? '' : 'width-unavailable'}">
        <div class="bet-header">
          <div>
            <span class="bet-title">${c.title}</span>
            <div class="bet-thesis" style="font-size: 11px; font-weight: 700; color: var(--accent-neutral); text-transform: uppercase; margin-top: 2px;">${c.type}</div>
            <div class="bet-strikes" style="margin-top: 6px; font-size: 11.5px; line-height: 1.3;">${c.strikes}</div>
            ${c.widthExact ? '' : '<div style="color: var(--accent-negative); font-size: 10.5px; font-weight: 700; margin-top: 4px;">⚠️ WIDTH NOT AVAILABLE (CLOSEST SHOWN)</div>'}
          </div>
          <span class="bet-grade">${parseFloat(c.winProb) > 65 ? 'A+' : parseFloat(c.winProb) > 50 ? 'A' : 'B'}</span>
        </div>
        
        <p style="font-size: 12px; color: var(--text-secondary); margin: 8px 0 12px 0; line-height: 1.4;">${c.desc}</p>
        
        <div class="bet-metrics">
          <div class="bet-metric">
            <span class="bet-metric-label">Win Probability</span>
            <span class="bet-metric-value positive">${c.winProb}</span>
          </div>
          <span class="bet-metric">
            <span class="bet-metric-label">Net Prem. Price</span>
            <span class="bet-metric-value">${c.premium}</span>
          </span>
          <div class="bet-metric">
            <span class="bet-metric-label">Max Reward</span>
            <span class="bet-metric-value positive">${c.maxProfit}</span>
          </div>
          <div class="bet-metric">
            <span class="bet-metric-label">Max Risk</span>
            <span class="bet-metric-value negative">${c.maxLoss}</span>
          </div>
        </div>
        
        <button class="quick-trade-btn" onclick="tradeSpreadFromChain('${ticker}', '${c.type}', '${c.legs}', '${c.premium}', '${c.maxLoss}')">
          Trade This Setup
        </button>
      </div>
    `).join("");
  })
  .catch(err => {
    callsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--accent-negative); padding: 12px;">Error fetching options data.</td></tr>`;
    putsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--accent-negative); padding: 12px;">Error fetching options data.</td></tr>`;
    strategiesGrid.innerHTML = `<div style="text-align: center; color: var(--accent-negative); padding: 24px; grid-column: span 3;">Error loading setup recommendations.</div>`;
    console.error(err);
  });
}

window.tradeSpreadFromChain = function(ticker, strategy, strikes, premium, risk, forceExpiry = null, forceQty = null) {
  const expiry = forceExpiry || document.getElementById("expirationSelect")?.value || "June 19, 2026 (14 Days)";
  
  // FIXED: Dynamically bind the latest selection count value from the DOM input elements
  const qty = forceQty || (document.getElementById("orderQtyInput") ? parseInt(document.getElementById("orderQtyInput").value) || 1 : 1);
  
  const rawPrem = parseFloat(premium.replace(/[^\d.-]/g, '')) || 0.0;
  const rawRisk = parseFloat(risk.replace(/[^\d.-]/g, '')) || 0.0;
  
  // FIXED: Updated template string to pass through the real parameter bounds
  showHoverPanel(
    `Execute Spread Order`,
    `
      <p style="margin-bottom: 12px;">Confirm execution of <strong>${qty}x ${ticker} ${strategy}</strong> via Alpaca Sandbox API:</p>
      <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; line-height: 1.5;">
        <strong>Asset:</strong> ${ticker} (${expiry})<br>
        <strong>Strikes:</strong> ${strikes}<br>
        <strong>Quantity:</strong> ${qty} contract(s)<br>
        <strong>Est Net Premium:</strong> ${premium.startsWith('+') || premium.startsWith('-') ? premium[0] : ''}$${Math.abs(rawPrem * 100 * qty).toFixed(2)} ($${rawPrem.toFixed(2)} each)<br>
        <strong>Collateral/Max Risk:</strong> $${(rawRisk * qty).toFixed(2)}
      </div>
      <button class="primary-btn" onclick="executeSpreadTrade('${ticker}', '${strategy}', '${strikes}', '${premium}', '${expiry}', ${qty})">
        Transmit Spread Order
      </button>
    `
  );
}

window.executeSpreadTrade = function(ticker, strategy, strikes, premium, expiry, qty) {
  showHoverPanel("Order Sent", `Routing multi-leg spread order to Alpaca: Transmitting ${qty}x ${ticker} ${strategy}...`);
  
  fetch(`/api/trade?username=${encodeURIComponent(currentUser)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: state.activeProfile,
      ticker: ticker,
      type: strategy,
      strike: strikes,
      price: premium,
      qty: parseInt(qty) || 1, // FIXED: Force actual runtime value state
      expiry: expiry
    })
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Spread execution failed");
    return data;
  })
  .then(data => {
    setTimeout(() => {
      showHoverPanel("Spread Order Filled", `Successfully executed ${ticker} spread! Option order placed via Alpaca. Message: ${data.message}`);
      
      const summaryList = document.getElementById("strategySummary");
      if (summaryList) {
        const newItem = document.createElement("div");
        newItem.className = "strategy-item hover-trigger";
        newItem.innerHTML = `
          <div class="strategy-info">
            <span class="strategy-title">${qty}x ${ticker} ${strategy}</span>
            <span class="strategy-meta">Expires ${expiry.split('(')[0].trim()}</span>
          </div>
          <span class="strategy-pnl positive">$0.00</span>
        `;
        summaryList.insertBefore(newItem, summaryList.firstChild);
      }
    }, 1000);
  })
  .catch(err => {
    showHoverPanel("Execution Error", `<span style="color: var(--accent-negative);">${err.message}</span>`);
  });
}

window.selectStrike = function(type, strike, price) {
  const ticker = document.getElementById("underlyingTicker").value;
  
  // FIXED: Read selection sizing configurations dynamically on click
  const qtyInput = document.getElementById("orderQtyInput");
  const qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
  
  showHoverPanel(
    `Execute ${ticker} Trade`,
    `
      <p style="margin-bottom: 12px;">Initiate a new options order via Alpaca Sandbox API:</p>
      <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
        <strong>Asset:</strong> ${ticker} $${strike} ${type}<br>
        <strong>Quantity:</strong> ${qty} contract(s)<br>
        <strong>Est. Price:</strong> $${price} per contract ($${(parseFloat(price) * 100 * qty).toFixed(2)})
      </div>
      <button class="primary-btn" onclick="executeTrade('${ticker}', '${type}', '${strike}', '${price}', ${qty})">
        Send Market Order
      </button>
    `
  );
}

window.executeTrade = function(ticker, type, strike, price, qty) {
  const expiry = document.getElementById("expirationSelect")?.value || "June 19, 2026 (14 Days)";
  showHoverPanel("Order Sent", `Routing order to Alpaca: Buy ${qty} contract(s) of ${ticker} $${strike} ${type} at $${price}...`);
  
  fetch(`/api/trade?username=${encodeURIComponent(currentUser)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: state.activeProfile,
      ticker: ticker,
      type: type,
      strike: strike,
      price: price,
      qty: parseInt(qty) || 1, // FIXED: Maps state bindings dynamically rather than default falling to 1
      expiry: expiry
    })
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Trade execution failed");
    return data;
  })
  .then(data => {
    setTimeout(() => {
      showHoverPanel("Order Filled", `Successfully executed Options trade via Alpaca! Message: ${data.message || 'Order placed'}`);
    }, 1000);
  })
  .catch(err => {
    showHoverPanel("Execution Error", `<span style="color: var(--accent-negative);">${err.message}</span>`);
  });
}

// Sync configuration state to server backend
async function saveStateToBackend() {
  if (!currentUser) return;
  const res = await fetch(`/api/profiles?username=${encodeURIComponent(currentUser)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state)
  });
  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.detail || "Failed to save configuration to backend.");
  }
  localStorage.setItem("auratrade_state_" + currentUser, JSON.stringify(state));
}

// ==========================================================================
// STRATEGY WIZARD LOGIC & RENDER ENGINE
// ==========================================================================
let wizDirection = "up";
let wizSpeed = "fast";
let wizChart = null;
window.wizOptionData = null;
window.wizSelectedPutStrike = null;
window.wizSelectedCallStrike = null;
window.wizCurrentTrade = null;

function initStrategyWizard() {
  const directionButtons = document.querySelectorAll("#wizDirectionGroup .wiz-select-btn");
  const speedButtons = document.querySelectorAll("#wizSpeedGroup .wiz-select-btn");
  const dateSelect = document.getElementById("wizDate");
  const tickerInput = document.getElementById("wizTicker");

  directionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      directionButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      wizDirection = btn.getAttribute("data-val");
      
      const speedSetting = document.getElementById("wizSpeedGroup").closest(".setting-item");
      if (wizDirection === "sideways" || wizDirection === "breakout") {
        speedSetting.style.display = "none";
      } else {
        speedSetting.style.display = "flex";
      }
      
      window.wizSelectedPutStrike = null;
      window.wizSelectedCallStrike = null;
      calculateWizardStrategy();
    });
  });

  speedButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      speedButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      wizSpeed = btn.getAttribute("data-val");
      
      window.wizSelectedPutStrike = null;
      window.wizSelectedCallStrike = null;
      calculateWizardStrategy();
    });
  });

  if (dateSelect) {
    dateSelect.addEventListener("change", () => {
      window.wizSelectedPutStrike = null;
      window.wizSelectedCallStrike = null;
      calculateWizardStrategy();
    });
  }
  if (tickerInput) {
    tickerInput.addEventListener("input", () => {
      window.wizSelectedPutStrike = null;
      window.wizSelectedCallStrike = null;
      calculateWizardStrategy();
    });
  }

  const wizQty = document.getElementById("wizQty");
  const wizSpreadWidth = document.getElementById("wizSpreadWidth");
  if (wizQty) {
    wizQty.addEventListener("input", () => {
      calculateWizardStrategy(true);
    });
  }
  if (wizSpreadWidth) {
    wizSpreadWidth.addEventListener("input", () => {
      window.wizSelectedPutStrike = null;
      window.wizSelectedCallStrike = null;
      calculateWizardStrategy();
    });
  }

  const wizBudgetButtons = document.querySelectorAll("#wizSpreadBudgetsGroup .wiz-budget-preset-btn");
  wizBudgetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      wizBudgetButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const budgetVal = parseFloat(btn.getAttribute("data-budget"));
      if (wizSpreadWidth) {
        window.wizSelectedPutStrike = null;
        window.wizSelectedCallStrike = null;
        wizSpreadWidth.value = (budgetVal / 100).toFixed(2);
        wizSpreadWidth.dispatchEvent(new Event('input'));
      }
    });
  });

  const loadWizOrderBtn = document.getElementById("loadWizOrderBtn");
  if (loadWizOrderBtn) {
    loadWizOrderBtn.addEventListener("click", () => {
      const ticker = tickerInput.value.trim().toUpperCase() || "QQQ";
      const mainQty = document.getElementById("orderQtyInput");
      const mainWidth = document.getElementById("spreadLimitInput");
      
      if (mainQty && wizQty) mainQty.value = wizQty.value;
      if (mainWidth && wizSpreadWidth) {
        mainWidth.value = wizSpreadWidth.value;
        const mainBudgetButtons = document.querySelectorAll("#spreadBudgetsGroup .budget-preset-btn");
        mainBudgetButtons.forEach(btn => {
          const budgetVal = (parseFloat(btn.getAttribute("data-budget")) / 100).toFixed(2);
          if (budgetVal === parseFloat(wizSpreadWidth.value).toFixed(2)) {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });
      }

      const optionsNavBtn = document.getElementById("nav-options");
      if(optionsNavBtn) optionsNavBtn.click();

      document.getElementById("underlyingTicker").value = ticker;
      renderOptionChain();

      showHoverPanel(
        "Wizard Strategy Loaded", 
        `Loaded option chain for <strong>${ticker}</strong>. Look for target strikes based on the recommended setup.`
      );
    });
  }

  const executeWizTradeBtn = document.getElementById("executeWizTradeBtn");
  if (executeWizTradeBtn) {
    executeWizTradeBtn.addEventListener("click", () => {
      if (window.wizCurrentTrade) {
        tradeSpreadFromChain(
          window.wizCurrentTrade.ticker,
          window.wizCurrentTrade.strategy,
          window.wizCurrentTrade.legs,
          window.wizCurrentTrade.premium,
          window.wizCurrentTrade.risk,
          window.wizCurrentTrade.expiry,
          window.wizCurrentTrade.qty
        );
      } else {
        showHoverPanel("Trade Error", "No strategy calculations found. Please try again.");
      }
    });
  }

  calculateWizardStrategy();
}

function calculateWizardStrategy(isStrikeAdjustment = false) {
  const ticker = document.getElementById("wizTicker").value.trim().toUpperCase() || "QQQ";
  const nameLabel = document.getElementById("recStrategyName");
  const textLabel = document.getElementById("recExplainerText");

  const profitLabel = document.getElementById("wizMaxProfit");
  const lossLabel = document.getElementById("wizMaxLoss");
  const probLabel = document.getElementById("wizWinProb");

  const wizQtyInput = document.getElementById("wizQty");
  const qty = parseInt(wizQtyInput ? wizQtyInput.value : 1) || 1;

  const wizSpreadWidthInput = document.getElementById("wizSpreadWidth");
  const width = parseFloat(wizSpreadWidthInput ? wizSpreadWidthInput.value : 1.0) || 1.0;

  const expirySelect = document.getElementById("wizDate");
  const expiryStr = expirySelect ? expirySelect.value : "";

  if (!isStrikeAdjustment) {
    window.wizSelectedPutStrike = null;
    window.wizSelectedCallStrike = null;
  }

  fetch(`/api/options/chain?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(expiryStr)}&username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(data => {
    if (!data.strikes || data.strikes.length === 0) return;
    
    // Check if selected width is valid
    const checkWidthAvailable = (w) => {
      for (let i = 0; i < data.strikes.length; i++) {
        const s1 = parseFloat(data.strikes[i].strike);
        for (let j = i + 1; j < data.strikes.length; j++) {
          const s2 = parseFloat(data.strikes[j].strike);
          if (Math.abs(Math.abs(s1 - s2) - w) < 0.02) {
            return true;
          }
        }
      }
      return false;
    };

    const wizPresetBtns = document.querySelectorAll("#wizSpreadBudgetsGroup .wiz-budget-preset-btn");
    wizPresetBtns.forEach(btn => {
      const budgetVal = parseFloat(btn.getAttribute("data-budget")) / 100;
      if (checkWidthAvailable(budgetVal)) {
        btn.classList.remove("width-unavailable");
      } else {
        btn.classList.add("width-unavailable");
      }
    });

    const recCard = document.querySelector(".wizard-rec-card");
    let warningEl = document.getElementById("wizWidthWarning");
    const currentWidthAvailable = checkWidthAvailable(width);
    
    if (recCard) {
      if (!currentWidthAvailable) {
        recCard.classList.add("width-unavailable");
        if (!warningEl) {
          warningEl = document.createElement("div");
          warningEl.id = "wizWidthWarning";
          warningEl.style = "color: var(--accent-negative); font-size: 11px; font-weight: 700; margin-top: 8px;";
          warningEl.textContent = "⚠️ WIDTH NOT AVAILABLE (CLOSEST SHOWN)";
          const badge = document.getElementById("recStrategyName");
          if (badge) {
            badge.parentNode.insertBefore(warningEl, badge.nextSibling);
          } else {
            recCard.appendChild(warningEl);
          }
        }
      } else {
        recCard.classList.remove("width-unavailable");
        if (warningEl) {
          warningEl.remove();
        }
      }
    }

    // Helper functions to get target strike from string strike
    const getStrikeObj = (sVal) => {
      return data.strikes.find(s => Math.abs(parseFloat(s.strike) - parseFloat(sVal)) < 0.02);
    };

    const findClosestStrikeObj = (targetVal, excludeVal = null) => {
      let closest = null;
      let minDiff = Infinity;
      for (const s of data.strikes) {
        const val = parseFloat(s.strike);
        if (excludeVal !== null && Math.abs(val - parseFloat(excludeVal)) < 0.02) {
          continue;
        }
        const diff = Math.abs(val - targetVal);
        if (diff < minDiff) {
          minDiff = diff;
          closest = s;
        }
      }
      return closest;
    };

    // Auto defaults using original logic
    const bpSellPut = findStrikeByDelta(data.strikes, -0.25, 'PUT');
    const bcSellCall = findStrikeByDelta(data.strikes, 0.25, 'CALL');
    const dbBuyCall = findStrikeByDelta(data.strikes, 0.50, 'CALL');
    const dbBuyPut = findStrikeByDelta(data.strikes, -0.50, 'PUT');

    let strategy = "";
    let explanation = "";
    let curveType = "";
    let maxProfit = 0;
    let maxLoss = 0;
    let winProb = "50%";
    let legs = "";
    let netPrem = 0;

    let showPutSelector = false;
    let showCallSelector = false;

    if (wizDirection === "up") {
      if (wizSpeed === "fast") {
        strategy = "Bull Call Debit Spread";
        curveType = "bull_call_spread";
        showCallSelector = true;
        
        // Target: Buy ITM Call, Sell OTM Call (+width)
        if (window.wizSelectedCallStrike === null && dbBuyCall) {
          window.wizSelectedCallStrike = dbBuyCall.strike;
        }
        const refCall = getStrikeObj(window.wizSelectedCallStrike) || dbBuyCall;
        if (refCall) {
          const buyStrikeVal = parseFloat(refCall.strike);
          const sellCallObj = findClosestStrikeObj(buyStrikeVal + width, refCall.strike);
          if (sellCallObj) {
            const cost = Math.max(0.05, parseFloat(refCall.callAsk) - parseFloat(sellCallObj.callBid));
            netPrem = -cost;
            maxLoss = Math.round(cost * 100 * qty);
            maxProfit = Math.round((width - cost) * 100 * qty);
            winProb = Math.round(parseFloat(refCall.callDelta) * 100);
            legs = `Buy ${refCall.strike}C / Sell ${sellCallObj.strike}C`;
          }
        }
        explanation = `
          <strong>Thesis Setup (Up Quickly) for QQQ:</strong><br>
          • <strong>Asset Target:</strong> Buy Call at <strong>${window.wizSelectedCallStrike || 'ITM'}</strong>, Sell Call at <strong>+$${width}</strong>.<br>
          • <strong>Ideal Entry Cost:</strong> Pay around <strong>40% to 45%</strong> of the spread width.<br>
          • <strong>Theta/Time Decay:</strong> Negative drag. Requires rapid rise before options expire.<br>
          • <strong>Rule-Based Exit:</strong> Exit at <strong>50% to 75% ROI</strong>.
        `;
      } else {
        strategy = "Bull Put Credit Spread";
        curveType = "bull_put_spread";
        showPutSelector = true;

        // Target: Sell OTM Put, Buy further OTM Put (-width)
        if (window.wizSelectedPutStrike === null && bpSellPut) {
          window.wizSelectedPutStrike = bpSellPut.strike;
        }
        const refPut = getStrikeObj(window.wizSelectedPutStrike) || bpSellPut;
        if (refPut) {
          const sellStrikeVal = parseFloat(refPut.strike);
          const buyPutObj = findClosestStrikeObj(sellStrikeVal - width, refPut.strike);
          if (buyPutObj) {
            const credit = Math.max(0.05, parseFloat(refPut.putBid) - parseFloat(buyPutObj.putAsk));
            netPrem = credit;
            maxProfit = Math.round(credit * 100 * qty);
            maxLoss = Math.round((width - credit) * 100 * qty);
            winProb = Math.round((1 - Math.abs(parseFloat(refPut.putDelta))) * 100);
            legs = `Sell ${refPut.strike}P / Buy ${buyPutObj.strike}P`;
          }
        }
        explanation = `
          <strong>Thesis Setup (Up Slowly / Flat) for QQQ:</strong><br>
          • <strong>Asset Target:</strong> Sell Put at <strong>${window.wizSelectedPutStrike || 'OTM'}</strong>, Buy Put at <strong>-$${width}</strong>.<br>
          • <strong>Ideal Premium Credit:</strong> Collect <strong>25% to 33%</strong> of the spread width.<br>
          • <strong>Theta/Time Decay:</strong> Positive decay. Time is on your side.<br>
          • <strong>Rule-Based Exit:</strong> Close at <strong>50% to 60% of max profit</strong>.
        `;
      }
    } else if (wizDirection === "down") {
      if (wizSpeed === "fast") {
        strategy = "Bear Put Debit Spread";
        curveType = "bear_put_spread";
        showPutSelector = true;

        // Target: Buy ITM Put, Sell OTM Put (-width)
        if (window.wizSelectedPutStrike === null && dbBuyPut) {
          window.wizSelectedPutStrike = dbBuyPut.strike;
        }
        const refPut = getStrikeObj(window.wizSelectedPutStrike) || dbBuyPut;
        if (refPut) {
          const buyStrikeVal = parseFloat(refPut.strike);
          const sellPutObj = findClosestStrikeObj(buyStrikeVal - width, refPut.strike);
          if (sellPutObj) {
            const cost = Math.max(0.05, parseFloat(refPut.putAsk) - parseFloat(sellPutObj.putBid));
            netPrem = -cost;
            maxLoss = Math.round(cost * 100 * qty);
            maxProfit = Math.round((width - cost) * 100 * qty);
            winProb = Math.round(Math.abs(parseFloat(refPut.putDelta)) * 100);
            legs = `Buy ${refPut.strike}P / Sell ${sellPutObj.strike}P`;
          }
        }
        explanation = `
          <strong>Thesis Setup (Down Quickly) for QQQ:</strong><br>
          • <strong>Asset Target:</strong> Buy Put at <strong>${window.wizSelectedPutStrike || 'ITM'}</strong>, Sell Put at <strong>-$${width}</strong>.<br>
          • <strong>Ideal Entry Cost:</strong> Pay around <strong>40% to 45%</strong> of the spread width.<br>
          • <strong>Theta/Time Decay:</strong> Negative drag. Requires rapid price drop.<br>
          • <strong>Rule-Based Exit:</strong> Exit at <strong>50% to 75% ROI</strong>.
        `;
      } else {
        strategy = "Bear Call Credit Spread";
        curveType = "bear_call_spread";
        showCallSelector = true;

        // Target: Sell OTM Call, Buy further OTM Call (+width)
        if (window.wizSelectedCallStrike === null && bcSellCall) {
          window.wizSelectedCallStrike = bcSellCall.strike;
        }
        const refCall = getStrikeObj(window.wizSelectedCallStrike) || bcSellCall;
        if (refCall) {
          const sellStrikeVal = parseFloat(refCall.strike);
          const buyCallObj = findClosestStrikeObj(sellStrikeVal + width, refCall.strike);
          if (buyCallObj) {
            const credit = Math.max(0.05, parseFloat(refCall.callBid) - parseFloat(buyCallObj.callAsk));
            netPrem = credit;
            maxProfit = Math.round(credit * 100 * qty);
            maxLoss = Math.round((width - credit) * 100 * qty);
            winProb = Math.round((1 - parseFloat(refCall.callDelta)) * 100);
            legs = `Sell ${refCall.strike}C / Buy ${buyCallObj.strike}C`;
          }
        }
        explanation = `
          <strong>Thesis Setup (Down Slowly / Flat) for QQQ:</strong><br>
          • <strong>Asset Target:</strong> Sell Call at <strong>${window.wizSelectedCallStrike || 'OTM'}</strong>, Buy Call at <strong>+$${width}</strong>.<br>
          • <strong>Ideal Premium Credit:</strong> Collect <strong>25% to 33%</strong> of the spread width.<br>
          • <strong>Theta/Time Decay:</strong> Positive decay. High win rate.<br>
          • <strong>Rule-Based Exit:</strong> Close at <strong>50% to 60% of max profit</strong>.
        `;
      }
    } else if (wizDirection === "sideways") {
      strategy = "Iron Condor";
      curveType = "iron_condor";
      showPutSelector = true;
      showCallSelector = true;

      if (window.wizSelectedPutStrike === null && bpSellPut) {
        window.wizSelectedPutStrike = bpSellPut.strike;
      }
      if (window.wizSelectedCallStrike === null && bcSellCall) {
        window.wizSelectedCallStrike = bcSellCall.strike;
      }

      const refPut = getStrikeObj(window.wizSelectedPutStrike) || bpSellPut;
      const refCall = getStrikeObj(window.wizSelectedCallStrike) || bcSellCall;

      if (refPut && refCall) {
        const putSellStrike = parseFloat(refPut.strike);
        const putBuyObj = findClosestStrikeObj(putSellStrike - width, refPut.strike);

        const callSellStrike = parseFloat(refCall.strike);
        const callBuyObj = findClosestStrikeObj(callSellStrike + width, refCall.strike);

        if (putBuyObj && callBuyObj) {
          const putCredit = parseFloat(refPut.putBid) - parseFloat(putBuyObj.putAsk);
          const callCredit = parseFloat(refCall.callBid) - parseFloat(callBuyObj.callAsk);
          const credit = Math.max(0.10, putCredit + callCredit);
          netPrem = credit;
          maxProfit = Math.round(credit * 100 * qty);
          maxLoss = Math.round((width - credit) * 100 * qty);
          winProb = Math.round((1 - Math.abs(parseFloat(refPut.putDelta)) - parseFloat(refCall.callDelta)) * 100);
          legs = `Sell ${refCall.strike}C/Buy ${callBuyObj.strike}C + Sell ${refPut.strike}P/Buy ${putBuyObj.strike}P`;
        }
      }
      explanation = `
        <strong>Thesis Setup (Rangebound/Quiet) for QQQ:</strong><br>
        • <strong>Asset Target:</strong> Sell OTM Call at <strong>${window.wizSelectedCallStrike || 'OTM'}</strong> and Sell OTM Put at <strong>${window.wizSelectedPutStrike || 'OTM'}</strong>.<br>
        • <strong>Theta/Time Decay:</strong> Maximum positive decay. Highly sensitive to rangebound markets.<br>
        • <strong>Rule-Based Exit:</strong> Exit early at <strong>50% max profit</strong>.
      `;
    }

    // Populate selectors panel
    const selectorsContainer = document.getElementById("wizStrikeSelectors");
    const adjustmentPanel = document.getElementById("wizStrikeAdjustmentPanel");
    
    if (selectorsContainer && adjustmentPanel) {
      if (!showPutSelector && !showCallSelector) {
        adjustmentPanel.style.display = "none";
      } else {
        adjustmentPanel.style.display = "block";
        let html = "";
        if (showPutSelector) {
          html += `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
              <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">Put Strike:</span>
              <select id="wizPutStrikeSelect" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; color: var(--text-primary); padding: 6px 12px; font-size: 13px; outline: none; width: 140px; cursor: pointer;">
                ${data.strikes.map(s => `<option value="${s.strike}" ${s.strike === window.wizSelectedPutStrike ? 'selected' : ''}>$${parseFloat(s.strike).toFixed(1)} (Δ ${s.putDelta})</option>`).join("")}
              </select>
            </div>
          `;
        }
        if (showCallSelector) {
          html += `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
              <span style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">Call Strike:</span>
              <select id="wizCallStrikeSelect" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; color: var(--text-primary); padding: 6px 12px; font-size: 13px; outline: none; width: 140px; cursor: pointer;">
                ${data.strikes.map(s => `<option value="${s.strike}" ${s.strike === window.wizSelectedCallStrike ? 'selected' : ''}>$${parseFloat(s.strike).toFixed(1)} (Δ +${s.callDelta})</option>`).join("")}
              </select>
            </div>
          `;
        }
        selectorsContainer.innerHTML = html;

        // Re-bind change listeners
        const putSelect = document.getElementById("wizPutStrikeSelect");
        if (putSelect) {
          putSelect.addEventListener("change", (e) => {
            window.wizSelectedPutStrike = e.target.value;
            calculateWizardStrategy(true);
          });
        }
        const callSelect = document.getElementById("wizCallStrikeSelect");
        if (callSelect) {
          callSelect.addEventListener("change", (e) => {
            window.wizSelectedCallStrike = e.target.value;
            calculateWizardStrategy(true);
          });
        }
      }
    }

    // Update UI Elements
    nameLabel.textContent = strategy;
    textLabel.innerHTML = explanation;
    profitLabel.textContent = `$${maxProfit}`;
    lossLabel.textContent = `$${maxLoss}`;
    probLabel.textContent = `${winProb}%`;

    // Save current trade bundle
    window.wizCurrentTrade = {
      ticker: ticker,
      strategy: strategy,
      legs: legs,
      premium: (netPrem >= 0 ? '+' : '-') + `$${Math.abs(netPrem).toFixed(2)}`,
      risk: `$${(maxLoss / qty).toFixed(2)}`,
      expiry: expiryStr,
      qty: qty
    };

    drawWizPnlChart(curveType);
  })
  .catch(err => {
    console.error("Error loading wizard strategy calculations:", err);
  });
}

function drawWizPnlChart(curveType) {
  const canvas = document.getElementById("wizPnlChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  
  const width = canvas.width = canvas.parentElement.clientWidth;
  const height = canvas.height = canvas.parentElement.clientHeight || 180;
  
  ctx.clearRect(0, 0, width, height);

  const computedStyle = getComputedStyle(document.documentElement);
  const colorPositive = computedStyle.getPropertyValue('--accent-positive').trim() || "#00e676";
  const colorNegative = computedStyle.getPropertyValue('--accent-negative').trim() || "#ff2a5f";

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  const zeroY = height / 2;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(width, zeroY);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineWidth = 3.5;

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  ctx.strokeStyle = gradient;

  ctx.beginPath();

  if (curveType === "bull_call_spread" || curveType === "bull_put_spread") {
    gradient.addColorStop(0, colorNegative);
    gradient.addColorStop(0.4, colorNegative);
    gradient.addColorStop(0.6, colorPositive);
    gradient.addColorStop(1, colorPositive);

    ctx.moveTo(0, zeroY + 45);
    ctx.lineTo(width * 0.35, zeroY + 45);
    ctx.lineTo(width * 0.65, zeroY - 45);
    ctx.lineTo(width, zeroY - 45);
  } 
  else if (curveType === "bear_put_spread" || curveType === "bear_call_spread") {
    gradient.addColorStop(0, colorPositive);
    gradient.addColorStop(0.4, colorPositive);
    gradient.addColorStop(0.6, colorNegative);
    gradient.addColorStop(1, colorNegative);

    ctx.moveTo(0, zeroY - 45);
    ctx.lineTo(width * 0.35, zeroY - 45);
    ctx.lineTo(width * 0.65, zeroY + 45);
    ctx.lineTo(width, zeroY + 45);
  }
  else if (curveType === "iron_condor") {
    gradient.addColorStop(0, colorNegative);
    gradient.addColorStop(0.3, colorPositive);
    gradient.addColorStop(0.7, colorPositive);
    gradient.addColorStop(1, colorNegative);

    ctx.moveTo(0, zeroY + 40);
    ctx.lineTo(width * 0.25, zeroY + 40);
    ctx.lineTo(width * 0.4, zeroY - 40);
    ctx.lineTo(width * 0.6, zeroY - 40);
    ctx.lineTo(width * 0.75, zeroY + 40);
    ctx.lineTo(width, zeroY + 40);
  }
  else if (curveType === "straddle") {
    gradient.addColorStop(0, colorPositive);
    gradient.addColorStop(0.5, colorNegative);
    gradient.addColorStop(1, colorPositive);

    ctx.moveTo(0, zeroY - 50);
    ctx.lineTo(width * 0.5, zeroY + 40);
    ctx.lineTo(width, zeroY - 50);
  }

  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = "10px Inter";
  ctx.fillText("PROFIT", 10, 20);
  ctx.fillText("LOSS", 10, height - 10);
  ctx.fillText("Stock Price →", width - 80, zeroY - 6);
}

// QQQ 10DTE Best Bets Screener
function renderBestBets() {
  const container = document.getElementById("bestBetsContainer");
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px; grid-column: span 3;">Scanning QQQ option chain for best risk/reward spreads...</div>`;

  const expiry = "June 15, 2026 (11 Days)";
  fetch(`/api/options/chain?ticker=QQQ&expiry=${encodeURIComponent(expiry)}&username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(data => {
    const qqqPrice = data.underlyingPrice || 740.0;
    const atm = Math.round(qqqPrice / 5) * 5;

    const bets = [
      {
        strategy: "Bull Put Credit Spread",
        strikes: `Sell ${atm - 15}P / Buy ${atm - 17}P ($2 wide)`,
        thesis: "Up Slowly / Flat",
        grade: "A+",
        winProb: "72.4%",
        roi: "37.9%",
        premium: "+$0.55",
        risk: "$145"
      },
      {
        strategy: "Iron Condor",
        strikes: `Sell ${atm + 15}C/Buy ${atm + 17}C + Sell ${atm - 15}P/Buy ${atm - 17}P`,
        thesis: "Sideways / Rangebound",
        grade: "A",
        winProb: "68.2%",
        roi: "110.5%",
        premium: "+$1.05",
        risk: "$95"
      },
      {
        strategy: "Bear Call Credit Spread",
        strikes: `Sell ${atm + 15}C / Buy ${atm + 17}C ($2 wide)`,
        thesis: "Down Slowly / Flat",
        grade: "A-",
        winProb: "74.1%",
        roi: "33.3%",
        premium: "+$0.50",
        risk: "$150"
      }
    ];

    container.innerHTML = bets.map(bet => `
      <div class="best-bet-item hover-trigger">
        <div class="best-header">
          <div>
            <span class="bet-title">${bet.strategy}</span>
            <div class="bet-thesis" style="font-size: 11px; font-weight: 700; color: var(--accent-neutral); text-transform: uppercase; margin-top: 2px;">${bet.thesis}</div>
            <div class="bet-strikes" style="margin-top: 6px;">${bet.strikes}</div>
          </div>
          <span class="bet-grade">${bet.grade}</span>
        </div>
        
        <div class="bet-metrics">
          <div class="bet-metric">
            <span class="bet-metric-label">Win Prob</span>
            <span class="bet-metric-value positive">${bet.winProb}</span>
          </div>
          <div class="bet-metric">
            <span class="bet-metric-label">Est Return</span>
            <span class="bet-metric-value">${bet.roi}</span>
          </div>
          <div class="bet-metric">
            <span class="bet-metric-label">Net Credit</span>
            <span class="bet-metric-value positive">${bet.premium}</span>
          </div>
          <div class="bet-metric">
            <span class="bet-metric-label">Collateral Cost</span>
            <span class="bet-metric-value negative">${bet.risk}</span>
          </div>
        </div>
        
        <button class="quick-trade-btn" onclick="tradeBestBet('${bet.strategy}', '${bet.strikes}', '${bet.premium}', '${bet.risk}', '${bet.thesis}')">
          Trade This Setup
        </button>
      </div>
    `).join("");
  })
  .catch(err => {
    console.error("Error generating dynamic best bets:", err);
    container.innerHTML = `<div style="text-align: center; color: var(--accent-negative); padding: 24px; grid-column: span 3;">Failed to load real-time QQQ bets. Setup your API Keys in Setup & Themes.</div>`;
  });
}

window.tradeBestBet = function(strategy, strikes, premium, risk, thesis) {
  showHoverPanel(
    `Execute Best Bet Order`,
    `
      <p style="margin-bottom: 12px;">Confirm execution of <strong>QQQ 10DTE ${strategy}</strong> (Thesis: ${thesis}) via Alpaca sandbox:</p>
      <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; line-height: 1.5;">
        <strong>Asset:</strong> QQQ (10 Days to Expiration)<br>
        <strong>Strikes:</strong> ${strikes}<br>
        <strong>Est Premium Net Credit:</strong> ${premium} (You collect)<br>
        <strong>Collateral Margin Required:</strong> ${risk}
      </div>
      <button class="primary-btn" onclick="executeBestBetTrade('${strategy}', '${strikes}', '${premium}')">
        Transmit Multi-Leg Order
      </button>
    `
  );
}

window.executeBestBetTrade = function(strategy, strikes, premium) {
  showHoverPanel("Order Sent", `Routing multi-leg spread order to Alpaca: Transmitting QQQ 10DTE ${strategy}...`);
  
  fetch(`/api/trade?username=${encodeURIComponent(currentUser)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: state.activeProfile,
      ticker: "QQQ",
      type: strategy,
      strike: strikes,
      price: premium,
      qty: 1,
      expiry: "June 15, 2026 (11 Days)"
    })
  })
  .then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Spread execution failed");
    return data;
  })
  .then(data => {
    setTimeout(() => {
      showHoverPanel("Spread Order Filled", `Successfully executed QQQ multi-leg spread! Option order placed via Alpaca. Message: ${data.message}`);
      
      const summaryList = document.getElementById("strategySummary");
      const newItem = document.createElement("div");
      newItem.className = "strategy-item hover-trigger";
      newItem.innerHTML = `
        <div class="strategy-info">
          <span class="strategy-title">QQQ ${strategy}</span>
          <span class="strategy-meta">Expires in 10 Days</span>
        </div>
        <span class="strategy-pnl positive">$0.00</span>
      `;
      summaryList.insertBefore(newItem, summaryList.firstChild);
    }, 1000);
  })
  .catch(err => {
    showHoverPanel("Execution Error", `<span style="color: var(--accent-negative);">${err.message}</span>`);
  });
}

// ==========================================================================
// TECHNICAL CHARTS & TECHNICAL INDICATORS ENGINE (HMA, SUPERTREND, STOCH)
// ==========================================================================
function initTechnicalCharts() {
  const wizTickerInput = document.getElementById("wizTicker");
  if (wizTickerInput) {
    wizTickerInput.addEventListener("input", debounce(() => {
      const ticker = wizTickerInput.value.trim().toUpperCase();
      if (ticker.length >= 1) renderTechnicalChart(ticker, "wizard");
    }, 500));
  }
  
  const fullTickerInput = document.getElementById("fullChartTicker");
  if (fullTickerInput) {
    fullTickerInput.addEventListener("input", debounce(() => {
      const ticker = fullTickerInput.value.trim().toUpperCase();
      if (ticker.length >= 1) renderTechnicalChart(ticker, "chart");
    }, 500));
  }
  
  const wizardNavBtn = document.getElementById("nav-wizard");
  if (wizardNavBtn) {
    wizardNavBtn.addEventListener("click", () => {
      const ticker = wizTickerInput ? wizTickerInput.value.trim().toUpperCase() : "AAPL";
      setTimeout(() => renderTechnicalChart(ticker, "wizard"), 100);
    });
  }
  
  const positionsNavBtn = document.getElementById("nav-positions");
  if (positionsNavBtn) {
    positionsNavBtn.addEventListener("click", () => {
      setTimeout(() => {
        renderPositions();
      }, 100);
    });
  }

  const fullChartNavBtn = document.getElementById("nav-chart");
  if (fullChartNavBtn) {
    fullChartNavBtn.addEventListener("click", () => {
      const ticker = fullTickerInput ? fullTickerInput.value.trim().toUpperCase() : "QQQ";
      setTimeout(() => renderTechnicalChart(ticker, "chart"), 100);
    });
  }
  
  // Reload dashboard charts on dashboard tab click
  const dashboardNavBtn = document.getElementById("nav-dashboard");
  if (dashboardNavBtn) {
    dashboardNavBtn.addEventListener("click", () => {
      setTimeout(() => {
        renderTechnicalChart("QQQ", "dashboard");
        renderDashboard();
        renderPositions();
      }, 100);
    });
  }

  setTimeout(() => {
    renderTechnicalChart("AAPL", "wizard");
    renderTechnicalChart("QQQ", "dashboard");
    renderTechnicalChart("QQQ", "chart");
  }, 1000);

  // Auto-refresh QQQ Dashboard chart, account balance, and positions every 5 seconds for close to live data
  setInterval(() => {
    const activeTab = document.querySelector(".nav-btn.active")?.getAttribute("data-tab");
    if (activeTab === "dashboard" || activeTab === "positions" || activeTab === "chart") {
      if (activeTab === "dashboard") {
        renderTechnicalChart("QQQ", "dashboard");
      } else if (activeTab === "chart") {
        const ticker = fullTickerInput ? fullTickerInput.value.trim().toUpperCase() : "QQQ";
        renderTechnicalChart(ticker, "chart");
      }
      renderDashboard();
      renderPositions();
    }
  }, 5000);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function updateMainChartLabels(chart, index) {
  if (!chart.sourceData) return;
  const idx = index >= 0 ? index : chart.sourceData.slicedHma.length - 1;
  const hmaVal = chart.sourceData.slicedHma[idx];
  const supertrendVal = chart.sourceData.slicedSupertrend[idx];
  chart.data.datasets[2].label = `30 HMA: ${hmaVal !== null && hmaVal !== undefined ? '$' + parseFloat(hmaVal).toFixed(2) : 'N/A'}`;
  chart.data.datasets[3].label = `Supertrend: ${supertrendVal !== null && supertrendVal !== undefined ? '$' + parseFloat(supertrendVal).toFixed(2) : 'N/A'}`;
}

function updateStochChartLabels(chart, index) {
  if (!chart.sourceData) return;
  const idx = index >= 0 ? index : chart.sourceData.slicedStoch14.length - 1;
  const stoch14Val = chart.sourceData.slicedStoch14[idx];
  const stoch40Val = chart.sourceData.slicedStoch40[idx];
  chart.data.datasets[0].label = `Stoch (14, 4 %D): ${stoch14Val !== null && stoch14Val !== undefined ? parseFloat(stoch14Val).toFixed(2) : 'N/A'}`;
  chart.data.datasets[1].label = `Stoch (40, 4 %D): ${stoch40Val !== null && stoch40Val !== undefined ? parseFloat(stoch40Val).toFixed(2) : 'N/A'}`;
}

function renderTechnicalChart(ticker, tab) {
  const isWiz = tab === "wizard";
  const isDash = tab === "dashboard";
  const isFull = tab === "chart";
  let mainCanvasId = "positionTechnicalChartCanvas";
  let stochCanvasId = "positionStochasticChartCanvas";
  if (isWiz) {
    mainCanvasId = "technicalChartCanvas";
    stochCanvasId = "stochasticChartCanvas";
  } else if (isDash) {
    mainCanvasId = "dashTechnicalChartCanvas";
    stochCanvasId = "dashStochasticChartCanvas";
  } else if (isFull) {
    mainCanvasId = "fullTechnicalChartCanvas";
    stochCanvasId = "fullStochasticChartCanvas";
  }
  
  const mainCanvas = document.getElementById(mainCanvasId);
  const stochCanvas = document.getElementById(stochCanvasId);
  if (!mainCanvas || !stochCanvas) return;
  
  fetch(`/api/chart/technical?ticker=${encodeURIComponent(ticker)}`)
  .then(res => res.json())
  .then(data => {
    if (isDash) {
      const livePriceEl = document.getElementById("dashLivePrice");
      if (livePriceEl && data.closes && data.closes.length > 0) {
        const lastPrice = data.closes[data.closes.length - 1];
        livePriceEl.textContent = `$${parseFloat(lastPrice).toFixed(2)}`;
      }
    }
    if (isFull) {
      const headerTitle = document.getElementById("fullChartTitle");
      if (headerTitle && data.closes && data.closes.length > 0) {
        const lastPrice = data.closes[data.closes.length - 1];
        headerTitle.innerHTML = `<i data-lucide="line-chart" style="color: var(--accent-neutral); margin-right: 8px; vertical-align: middle;"></i> ${ticker.toUpperCase()} Full Chart (1h Candles, 1 Week) <span style="margin-left: 15px; color: var(--accent-neutral); font-weight: 700;">$${parseFloat(lastPrice).toFixed(2)}</span>`;
        lucide.createIcons();
      }
    }
    
    const isMobile = window.innerWidth <= 900;
    const sliceCount = isMobile ? 20 : 40;
    const slicedTimestamps = data.timestamps.slice(-sliceCount);
    const slicedCloses = data.closes.slice(-sliceCount);
    const slicedOpens = data.opens.slice(-sliceCount);
    const slicedHighs = data.highs.slice(-sliceCount);
    const slicedLows = data.lows.slice(-sliceCount);
    const slicedHma = data.hma30.slice(-sliceCount);
    const slicedSupertrend = data.supertrend.slice(-sliceCount);
    const slicedSupertrendDir = data.supertrendDirection.slice(-sliceCount);
    const slicedStoch14 = data.stoch14_4d.slice(-sliceCount);
    const slicedStoch40 = data.stoch40_4d.slice(-sliceCount);

    const labels = slicedTimestamps.map(ts => {
      const d = new Date(ts * 1000);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    });
    
    const supertrendSegmentColor = (ctx) => {
      if (ctx.type === 'section') return;
      const index = ctx.p1DataIndex;
      const dir = slicedSupertrendDir[index];
      return dir === 1 ? "#00e676" : "#ff2a5f";
    };
    
    const computedStyle = getComputedStyle(document.documentElement);
    const colorPositive = computedStyle.getPropertyValue('--accent-positive').trim() || "#00e676";
    const colorNegative = computedStyle.getPropertyValue('--accent-negative').trim() || "#ff2a5f";

    const colors = slicedCloses.map((c, i) => c >= slicedOpens[i] ? colorPositive : colorNegative);
    const wicksData = slicedCloses.map((c, i) => [slicedLows[i], slicedHighs[i]]);
    const bodiesData = slicedCloses.map((c, i) => [slicedOpens[i], c]);

    // Gather breakevens for the current ticker from cache
    const activeTickerPositions = (window.activePositionsCache || []).filter(
      pos => pos.ticker && pos.ticker.toUpperCase() === ticker.toUpperCase()
    );

    const breakevenDatasets = [];
    const warmColors = ["#ff3366", "#ff6600", "#ffcc00", "#e6ad00"];
    const coolColors = ["#00e676", "#00b0ff", "#d500f9", "#00e5ff"];
    let warmIdx = 0;
    let coolIdx = 0;
    let allBreakevenPrices = [];

    activeTickerPositions.forEach(pos => {
      if (pos.breakevens && Array.isArray(pos.breakevens)) {
        pos.breakevens.forEach(be => {
          const price = parseFloat(be.price);
          if (!isNaN(price)) {
            allBreakevenPrices.push(price);
            let color = "#ffffff";
            if (be.direction === "under") {
              color = warmColors[warmIdx % warmColors.length];
              warmIdx++;
            } else {
              color = coolColors[coolIdx % coolColors.length];
              coolIdx++;
            }
            
            const beData = new Array(labels.length).fill(price);
            breakevenDatasets.push({
              type: "line",
              label: `${pos.type} BE: $${price.toFixed(2)}`,
              data: beData,
              borderColor: color,
              borderWidth: 1.5,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false,
              order: 4
            });
          }
        });
      }
    });

    const ctxMain = mainCanvas.getContext("2d");
    let currentMainChart = isWiz ? wizTechChart : (isDash ? dashTechChart : (isFull ? fullTechChart : posTechChart));

    // Calculate baseline bounds based on high/low wicks
    let minLows = Math.min(...slicedLows);
    let maxHighs = Math.max(...slicedHighs);

    // Expand bounds if we have breakeven lines to show, but constrain expansion to prevent chart crash/extreme flattening
    if (allBreakevenPrices.length > 0) {
      const currentRange = maxHighs - minLows || 1.0;
      const maxAllowedExpansion = currentRange * 0.20; // limit expansion to 20% of current high/low range
      
      const minBE = Math.min(...allBreakevenPrices);
      const maxBE = Math.max(...allBreakevenPrices);
      
      const targetMin = Math.max(minLows - maxAllowedExpansion, minBE);
      const targetMax = Math.min(maxHighs + maxAllowedExpansion, maxBE);
      
      minLows = Math.min(minLows, targetMin);
      maxHighs = Math.max(maxHighs, targetMax);
    }

    const yMin = Math.floor(minLows - ((maxHighs - minLows) * 0.05 || 2.0));
    const yMax = Math.ceil(maxHighs + ((maxHighs - minLows) * 0.05 || 2.0));

    if (currentMainChart) {
      currentMainChart.data.labels = labels;
      currentMainChart.data.datasets[0].data = bodiesData;
      currentMainChart.data.datasets[0].backgroundColor = colors;
      currentMainChart.data.datasets[0].borderColor = colors;
      currentMainChart.data.datasets[1].data = wicksData;
      currentMainChart.data.datasets[1].backgroundColor = colors;
      currentMainChart.data.datasets[1].borderColor = colors;
      currentMainChart.data.datasets[2].data = slicedHma;
      currentMainChart.data.datasets[3].data = slicedSupertrend;
      
      // Clean up old breakeven datasets if any existed
      currentMainChart.data.datasets = currentMainChart.data.datasets.slice(0, 4);
      // Append the new ones
      breakevenDatasets.forEach(ds => {
        currentMainChart.data.datasets.push(ds);
      });

      currentMainChart.sourceData = { slicedHma, slicedSupertrend };
      updateMainChartLabels(currentMainChart, currentMainChart.lastHoveredIndex !== undefined ? currentMainChart.lastHoveredIndex : -1);
      
      // Ensure mobile version and updates also use line style and hide candle elements
      if (!currentMainChart.options.plugins) {
        currentMainChart.options.plugins = {};
      }
      if (!currentMainChart.options.plugins.legend) {
        currentMainChart.options.plugins.legend = {};
      }
      currentMainChart.options.plugins.legend.labels = {
        color: "rgba(255,255,255,0.7)",
        font: { size: 10 },
        usePointStyle: true,
        pointStyle: "line",
        filter: function(item, chart) {
          return !["Price Body", "Wick Range"].includes(item.text);
        }
      };
      
      currentMainChart.options.scales.y.min = yMin;
      currentMainChart.options.scales.y.max = yMax;
      currentMainChart.update("none");
    } else {
      const initialDatasets = [
        {
          type: "bar",
          label: "Price Body",
          data: bodiesData,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1,
          barThickness: 10,
          grouped: false,
          order: 2
        },
        {
          type: "bar",
          label: "Wick Range",
          data: wicksData,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1,
          barThickness: 2,
          grouped: false,
          order: 3
        },
        {
          type: "line",
          label: "30 HMA",
          data: slicedHma,
          borderColor: "#ffb800",
          borderWidth: 1.8,
          pointRadius: 0,
          borderDash: [5, 4],
          tension: 0.2,
          order: 1
        },
        {
          type: "line",
          label: "Supertrend",
          data: slicedSupertrend,
          borderWidth: 2.5,
          pointRadius: 0,
          segment: {
            borderColor: supertrendSegmentColor
          },
          tension: 0.1,
          order: 0
        }
      ];

      // Append active breakeven datasets
      breakevenDatasets.forEach(ds => {
        initialDatasets.push(ds);
      });

      const newMainChart = new Chart(ctxMain, {
        type: "bar",
        data: {
          labels: labels,
          datasets: initialDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          onHover: (event, activeElements, chart) => {
            const activeIndex = activeElements && activeElements.length > 0 ? activeElements[0].index : -1;
            if (!chart) return;
            if (chart.lastHoveredIndex === activeIndex) return;
            chart.lastHoveredIndex = activeIndex;
            updateMainChartLabels(chart, activeIndex);
            chart.update("none");
          },
          plugins: {
            legend: {
              labels: {
                color: "rgba(255,255,255,0.7)",
                font: { size: 10 },
                usePointStyle: true,
                pointStyle: "line",
                filter: function(item, chart) {
                  // Hide Price Body and Wick Range from the legend display
                  return !["Price Body", "Wick Range"].includes(item.text);
                }
              }
            }
          },
          scales: {
            x: { 
              stacked: true,
              grid: { color: "rgba(255, 255, 255, 0.03)" }, 
              ticks: { 
                color: "rgba(255,255,255,0.5)", 
                font: { size: 9 },
                maxTicksLimit: 8,
                maxRotation: 0,
                minRotation: 0
              } 
            },
            y: { 
              grid: { color: "rgba(255, 255, 255, 0.03)" }, 
              ticks: { color: "rgba(255,255,255,0.5)" },
              min: yMin,
              max: yMax
            }
          }
        }
      });
      
      newMainChart.sourceData = { slicedHma, slicedSupertrend };
      updateMainChartLabels(newMainChart, -1);
      newMainChart.update("none");

      if (isWiz) wizTechChart = newMainChart;
      else if (isDash) dashTechChart = newMainChart;
      else if (isFull) fullTechChart = newMainChart;
      else posTechChart = newMainChart;
    }
    
    const ctxStoch = stochCanvas.getContext("2d");
    let currentStochChart = isWiz ? wizStochChart : (isDash ? dashStochChart : (isFull ? fullStochChart : posStochChart));
    
    if (currentStochChart) {
      currentStochChart.data.labels = labels;
      currentStochChart.data.datasets[0].data = slicedStoch14;
      currentStochChart.data.datasets[1].data = slicedStoch40;
      currentStochChart.sourceData = { slicedStoch14, slicedStoch40 };
      updateStochChartLabels(currentStochChart, currentStochChart.lastHoveredIndex !== undefined ? currentStochChart.lastHoveredIndex : -1);
      currentStochChart.update("none");
    } else {
      const newStochChart = new Chart(ctxStoch, {
        type: "line",
        data: {
          labels: labels,
          datasets: [
            {
              label: "Stoch (14, 4 %D)",
              data: slicedStoch14,
              borderColor: colorNegative,
              borderWidth: 1.5,
              pointRadius: 0,
              tension: 0.2
            },
            {
              label: "Stoch (40, 4 %D)",
              data: slicedStoch40,
              borderColor: "#7000ff",
              borderWidth: 1.5,
              pointRadius: 0,
              tension: 0.2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          onHover: (event, activeElements, chart) => {
            const activeIndex = activeElements && activeElements.length > 0 ? activeElements[0].index : -1;
            if (!chart) return;
            if (chart.lastHoveredIndex === activeIndex) return;
            chart.lastHoveredIndex = activeIndex;
            updateStochChartLabels(chart, activeIndex);
            chart.update("none");
          },
          plugins: {
            legend: {
              labels: {
                color: "rgba(255,255,255,0.7)",
                font: { size: 10 },
                usePointStyle: true,
                pointStyle: "line"
              }
            }
          },
          scales: {
            x: { 
              grid: { color: "rgba(255, 255, 255, 0.03)" }, 
              ticks: { 
                color: "rgba(255,255,255,0.5)", 
                font: { size: 9 },
                maxTicksLimit: 8,
                maxRotation: 0,
                minRotation: 0
              } 
            },
            y: { 
              grid: { color: "rgba(255, 255, 255, 0.03)" }, 
              ticks: { color: "rgba(255,255,255,0.5)" },
              min: 0,
              max: 100
            }
          }
        }
      });
      
      newStochChart.sourceData = { slicedStoch14, slicedStoch40 };
      updateStochChartLabels(newStochChart, -1);
      newStochChart.update("none");

      if (isWiz) wizStochChart = newStochChart;
      else if (isDash) dashStochChart = newStochChart;
      else if (isFull) fullStochChart = newStochChart;
      else posStochChart = newStochChart;
    }
  })
  .catch(err => console.error("Error drawing technical indicators chart:", err));
}

// Popular Tickers Setup
const popularTickers = ["TSLA", "AAPL", "MSFT", "NVDA", "AMD", "PLTR", "SOFI"];

function initBeginnerBaskets() {
  renderPopularTickers();
}

function renderPopularTickers() {
  const listContainer = document.getElementById("basketTickersList");
  if (!listContainer) return;
  
  listContainer.innerHTML = popularTickers.map(ticker => `
    <button class="strategy-badge ticker-badge" style="cursor: pointer; margin-bottom: 0; padding: 6px 12px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;" onclick="loadTickerFromBasket('${ticker}')">
      ${ticker}
    </button>
  `).join("");
}

window.loadTickerFromBasket = function(ticker) {
  const tickerInput = document.getElementById("underlyingTicker");
  if (tickerInput) {
    tickerInput.value = ticker;
    renderOptionChain();
  }
}

function initSpreadBudgets() {
  const budgetButtons = document.querySelectorAll("#spreadBudgetsGroup .budget-preset-btn");
  const spreadLimitInput = document.getElementById("spreadLimitInput");
  
  budgetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      budgetButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const budgetVal = parseFloat(btn.getAttribute("data-budget"));
      if (spreadLimitInput) {
        spreadLimitInput.value = (budgetVal / 100).toFixed(2);
        spreadLimitInput.dispatchEvent(new Event('change'));
      }
    });
  });

  if (spreadLimitInput) {
    spreadLimitInput.addEventListener("change", () => {
      renderOptionChain();
    });
  }
}

function initExpirationDates() {
  const today = new Date();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  const formatDate = (dateObj) => {
    return `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
  };

  // 1. This Friday
  const thisFriday = new Date(today);
  const day = today.getDay();
  const daysToFriday = (5 - day + 7) % 7;
  let offset = daysToFriday;
  if (day === 6 || day === 0) {
    offset = daysToFriday + 7;
  }
  thisFriday.setDate(today.getDate() + offset);
  
  // 2. Next Friday
  const nextFriday = new Date(thisFriday);
  nextFriday.setDate(thisFriday.getDate() + 7);
  
  // 3. Last Friday of Month
  let lastFriday = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  while (lastFriday.getDay() !== 5) {
    lastFriday.setDate(lastFriday.getDate() - 1);
  }
  if (lastFriday < today) {
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    while (nextMonth.getDay() !== 5) {
      nextMonth.setDate(nextMonth.getDate() - 1);
    }
    lastFriday = nextMonth;
  }

  const dateOptions = [
    { label: "This Friday", dateStr: formatDate(thisFriday) },
    { label: "Next Friday", dateStr: formatDate(nextFriday) },
    { label: "Last Friday of month", dateStr: formatDate(lastFriday) }
  ];

  // Populate expirationSelect dropdown (Option Chain Builder)
  const expirationSelect = document.getElementById("expirationSelect");
  if (expirationSelect) {
    expirationSelect.innerHTML = dateOptions.map(opt => 
      `<option value="${opt.dateStr}">${opt.label} (${opt.dateStr})</option>`
    ).join("");
  }

  // Populate wizDate dropdown (Strategy Wizard)
  const wizDateSelect = document.getElementById("wizDate");
  if (wizDateSelect) {
    wizDateSelect.innerHTML = dateOptions.map(opt => 
      `<option value="${opt.dateStr}">${opt.label} (${opt.dateStr})</option>`
    ).join("");
  }
}

window.handleClosePosition = function(ticker, type, strike, qty, expiry_yymmdd) {
  if (!confirm(`Are you sure you want to close your ${ticker} ${type} position?`)) {
    return;
  }
  
  const payload = {
    username: currentUser,
    profile: state.activeProfile,
    ticker: ticker,
    type: type,
    strike: strike,
    qty: parseInt(qty) || 1,
    expiry_yymmdd: expiry_yymmdd
  };
  
  fetch('/api/positions/close', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(data => { throw new Error(data.detail || 'Failed to close position.'); });
    }
    return res.json();
  })
  .then(data => {
    alert(data.message || 'Position closing order submitted successfully.');
    renderDashboard();
    renderPositions();
  })
  .catch(err => {
    alert(`Error: ${err.message}`);
  });
};

window.toggleDashboardPosition = function(posKey) {
  if (expandedDashboardPositions.has(posKey)) {
    expandedDashboardPositions.delete(posKey);
  } else {
    expandedDashboardPositions.add(posKey);
  }
  renderDashboard();
};

window.toggleTablePosition = function(posKey) {
  if (expandedPositions.has(posKey)) {
    expandedPositions.delete(posKey);
  } else {
    expandedPositions.add(posKey);
  }
  renderPositions(true);
};

function renderTugOfWarMeter(pos) {
  return '';
}

function _unused_renderTugOfWarMeter(pos) {
  console.log("Position data for meter:", pos);
  
  // Robust fallback logic in case keys are missing or formatted differently
  const entry = pos.entry_price !== undefined ? parseFloat(pos.entry_price) : parseFloat(pos.avg);
  const current = pos.current_value !== undefined ? parseFloat(pos.current_value) : parseFloat(pos.mark);
  
  if (isNaN(entry) || isNaN(current)) {
    console.log("Meter skipped due to NaN: entry =", entry, ", current =", current);
    return '';
  }
  
  const isCredit = pos.is_credit !== undefined ? pos.is_credit : (pos.type.toLowerCase().includes("credit") || pos.type.toLowerCase().includes("condor") || pos.qty < 0);
  const target = pos.profit_target !== undefined ? parseFloat(pos.profit_target) : (isCredit ? entry * 0.50 : entry * 1.50);
  const stop = pos.stop_loss !== undefined ? parseFloat(pos.stop_loss) : (isCredit ? entry * 2.00 : entry * 0.50);
  
  let percent = 0;
  let entryPercent = 0;
  let leftLabel = '';
  let rightLabel = '';
  let leftColorClass = '';
  let rightColorClass = '';
  let currentValueLabel = '';
  
  if (isCredit) {
    const range = stop - target;
    percent = Math.min(100, Math.max(0, ((current - target) / (range || 1)) * 100));
    entryPercent = ((entry - target) / (range || 1)) * 100;
    
    leftLabel = `Take Profit: $${target.toFixed(2)}`;
    rightLabel = `Stop Loss: $${stop.toFixed(2)}`;
    leftColorClass = 'profit-zone';
    rightColorClass = 'loss-zone';
    currentValueLabel = `Current Cost: $${current.toFixed(2)}`;
  } else {
    const range = target - stop;
    percent = Math.min(100, Math.max(0, ((current - stop) / (range || 1)) * 100));
    entryPercent = ((entry - stop) / (range || 1)) * 100;
    
    leftLabel = `Stop Loss: $${stop.toFixed(2)}`;
    rightLabel = `Take Profit: $${target.toFixed(2)}`;
    leftColorClass = 'loss-zone';
    rightColorClass = 'profit-zone';
    currentValueLabel = `Current Value: $${current.toFixed(2)}`;
  }

  let distanceText = '';
  if (isCredit) {
    if (current <= target) {
      distanceText = 'Take Profit condition met!';
    } else if (current >= stop) {
      distanceText = 'Stop Loss condition met!';
    } else {
      const distanceToSL = stop - current;
      const distanceToTP = current - target;
      distanceText = distanceToTP < distanceToSL 
        ? `$${distanceToTP.toFixed(2)} to Take Profit` 
        : `$${distanceToSL.toFixed(2)} to Stop Loss`;
    }
  } else {
    if (current >= target) {
      distanceText = 'Take Profit condition met!';
    } else if (current <= stop) {
      distanceText = 'Stop Loss condition met!';
    } else {
      const distanceToSL = current - stop;
      const distanceToTP = target - current;
      distanceText = distanceToTP < distanceToSL 
        ? `$${distanceToTP.toFixed(2)} to Take Profit` 
        : `$${distanceToSL.toFixed(2)} to Stop Loss`;
    }
  }
  
  return `
    <div class="tug-of-war-container" style="margin-top: 16px; width: 100%;">
      <div class="tug-of-war-labels" style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; color: var(--text-muted);">
        <span>${leftLabel}</span>
        <span style="font-weight: 700; color: var(--text-primary);">${currentValueLabel}</span>
        <span>${rightLabel}</span>
      </div>
      
      <div class="tug-of-war-track-wrapper" style="position: relative; height: 12px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); overflow: visible; margin: 16px 0;">
        <div style="position: absolute; left: 0; width: ${entryPercent}%; height: 100%; border-radius: 5px 0 0 5px;" class="${leftColorClass}"></div>
        <div style="position: absolute; left: ${entryPercent}%; right: 0; height: 100%; border-radius: 0 5px 5px 0;" class="${rightColorClass}"></div>
        
        <div class="meter-entry-pin" style="position: absolute; left: ${entryPercent}%; top: -6px; width: 2px; height: 22px; background: #ffffff; box-shadow: 0 0 8px #ffffff; z-index: 2;">
          <span class="tug-of-war-entry-label" style="position: absolute; top: -14px; left: -18px; font-size: 8px; font-weight: 800; color: #ffffff; text-transform: uppercase;">Entry ($${entry.toFixed(2)})</span>
        </div>
        
        <div class="meter-current-pointer" style="position: absolute; left: ${percent}%; top: -3px; width: 16px; height: 16px; border-radius: 50%; background: var(--accent-neutral); border: 2px solid #ffffff; box-shadow: 0 0 10px var(--accent-neutral); z-index: 3; transform: translateX(-8px); transition: left 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);"></div>
      </div>
      
      <div class="tug-of-war-distance" style="text-align: center; font-size: 10px; color: var(--accent-neutral); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">
        ${distanceText}
      </div>
    </div>
  `;
}

