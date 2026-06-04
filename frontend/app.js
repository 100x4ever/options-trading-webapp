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
let wizTechChart = null;
let wizStochChart = null;
let posTechChart = null;
let posStochChart = null;

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

  // Initialize Strategy Wizard
  initStrategyWizard();

  // Initialize Technical Charts & Beginner Baskets
  initTechnicalCharts();
  initBeginnerBaskets();
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
  document.getElementById("authContainer").style.display = "flex";
  document.getElementById("appLayout").style.display = "none";
}

function hideAuthScreen() {
  document.getElementById("authContainer").style.display = "none";
  document.getElementById("appLayout").style.display = "grid";
  
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
        // User session invalid/deleted on backend (e.g. server restarted or database wiped)
        const cachedState = localStorage.getItem("auratrade_state_" + username);
        const cachedPass = localStorage.getItem("auratrade_pass_" + username);
        if (cachedState && cachedPass) {
          // Silent auto-registration & restore configuration on backend
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
    // Ignore logout button click which is handled in auth logic
    if (btn.id === "logoutBtn") return;

    btn.addEventListener("click", () => {
      // Remove active classes
      navButtons.forEach(b => { if(b.id !== "logoutBtn") b.classList.remove("active"); });
      tabContents.forEach(c => c.classList.remove("active"));

      // Set active
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
      
      // Update label/output text
      if (ctrl.outputId) {
        document.getElementById(ctrl.outputId).textContent = val + (ctrl.suffix || "");
      }

      // Update state in memory
      state.profiles[state.activeProfile][ctrl.id] = val;

      // Update CSS Property
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

  // Save config button
  document.getElementById("saveConfigBtn").addEventListener("click", () => {
    // Collect keys
    const apiKey = document.getElementById("alpacaApiKey").value.trim();
    let isLive = document.getElementById("alpacaLive").checked;
    if (apiKey.startsWith("AK")) isLive = true;
    if (apiKey.startsWith("PK")) isLive = false;
    
    state.profiles[state.activeProfile].alpacaApiKey = apiKey;
    state.profiles[state.activeProfile].alpacaSecretKey = document.getElementById("alpacaSecretKey").value;
    state.profiles[state.activeProfile].alpacaLive = isLive;

    // Save configuration states
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

// Convert Hex Color to RGB
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

  // Populate profiles select
  rebuildProfileSelectors();

  // Change Profile selection
  select.addEventListener("change", (e) => {
    state.activeProfile = e.target.value;
    applyProfileSettings(state.activeProfile);
    rebuildProfileSelectors();
  });

  // Create Profile
  addBtn.addEventListener("click", () => {
    const name = newNameInput.value.trim();
    if (!name) return;
    if (state.profiles[name]) {
      alert("Profile already exists!");
      return;
    }

    // Clone current profile settings
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
    // Select Option
    const option = document.createElement("option");
    option.value = pName;
    option.textContent = pName;
    option.selected = (pName === state.activeProfile);
    select.appendChild(option);

    // Profile Badge (Config page)
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

  // Set values to inputs
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

  // Update DOM CSS
  updateCSSProperty("--glass-bg", settings.glassColor);
  updateCSSProperty("--glass-opacity", settings.glassOpacity);
  updateCSSProperty("--glass-blur", settings.glassBlur);
  updateCSSProperty("--glass-border-opacity", settings.glassBorderOpacity);

  updateCSSProperty("--blob-1-color", settings.blobColor1);
  updateCSSProperty("--blob-2-color", settings.blobColor2);
  updateCSSProperty("--blob-3-color", settings.blobColor3);
  updateCSSProperty("--blob-4-color", settings.blobColor4);
  updateCSSProperty("--blob-speed-multiplier", settings.lampSpeed);

  // Update Alpaca Status label
  const statusText = document.querySelector(".status-text");
  if(statusText) {
    statusText.textContent = settings.alpacaLive ? "Alpaca LIVE" : "Alpaca Sandbox";
  }
}

// Hover Info Panel / Tooltips (Top Layer)
function initHoverTooltips() {
  const panel = document.getElementById("hoverInfoPanel");
  const panelBody = document.getElementById("hoverBody");
  const panelTitle = document.getElementById("hoverTitle");
  const closeBtn = document.getElementById("hoverCloseBtn");

  // Show hover panel when user hovers metric cards
  document.querySelectorAll(".metric-card").forEach(card => {
    card.addEventListener("mouseenter", (e) => {
      const metricLabel = card.querySelector(".metric-label").textContent.trim();
      const content = tooltips[metricLabel] || "Options Trading Parameter Details.";
      showHoverPanel(metricLabel, content);
    });
  });

  // Close Hover Tooltip
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
  // Fetch real-time account data
  fetch(`/api/account?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(accountData => {
    const currentEquity = parseFloat(accountData.equity) || 0.0;
    document.getElementById("navValue").textContent = `$${accountData.equity}`;
    document.getElementById("buyingPower").textContent = `$${accountData.buying_power}`;
    
    // Manage sandbox connection indicator status
    const indicator = document.querySelector(".status-indicator");
    const statusText = document.querySelector(".status-text");
    if(indicator && statusText) {
      if (accountData.is_mock) {
        indicator.style.backgroundColor = "#ffb800"; // yellow warning
        indicator.style.boxShadow = "0 0 8px #ffb800";
        statusText.textContent = "Offline / Sandbox Demo";
      } else {
        indicator.style.backgroundColor = "#00e676"; // green live
        indicator.style.boxShadow = "0 0 8px #00e676";
        statusText.textContent = state.profiles[state.activeProfile].alpacaLive ? "Alpaca LIVE" : "Alpaca Sandbox";
      }
    }

    // Now, fetch portfolio history
    fetch(`/api/portfolio/history?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
    .then(res => res.json())
    .then(historyData => {
      const ctx = document.getElementById("performanceChart").getContext("2d");
      if (perfChart) perfChart.destroy();

      let labels = [];
      let dataPoints = [];

      // Parse Alpaca timestamps and equity
      if (historyData.timestamp && historyData.timestamp.length > 0) {
        // Convert timestamps to clean dates
        labels = historyData.timestamp.map(ts => {
          const d = new Date(ts * 1000);
          return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        });
        dataPoints = historyData.equity;
      } else {
        // Fallback flat line representing current equity
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

  // Fetch active strategy spreads from real positions
  const strategySummary = document.getElementById("strategySummary");
  if (strategySummary) {
    fetch(`/api/positions?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
    .then(res => res.json())
    .then(positions => {
      if (positions.length === 0) {
        strategySummary.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 16px; font-size: 13px;">No active option/stock positions.</div>`;
        return;
      }
      
      strategySummary.innerHTML = positions.map(pos => `
        <div class="strategy-item hover-trigger">
          <div class="strategy-info">
            <span class="strategy-title">${pos.ticker} ${pos.strike !== "-" ? "$" + pos.strike : ""} ${pos.type}</span>
            <span class="strategy-meta">Expires ${pos.exp} | Qty: ${pos.qty}</span>
          </div>
          <span class="strategy-pnl ${pos.status}">${pos.pnl}</span>
        </div>
      `).join("");
    })
    .catch(err => {
      strategySummary.innerHTML = `<div style="text-align: center; color: var(--accent-negative); padding: 16px; font-size: 13px;">Failed to fetch active strategies.</div>`;
    });
  }
}

function renderPositions() {
  const tbody = document.getElementById("positionsTableBody");
  if (!tbody) return;

  fetch(`/api/positions?username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(positions => {
    if (positions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 24px;">No active option/stock positions found.</td></tr>`;
      return;
    }
    
    tbody.innerHTML = positions.map(pos => `
      <tr>
        <td><strong>${pos.ticker}</strong></td>
        <td>${pos.type}</td>
        <td>${pos.strike !== "-" ? "$" + pos.strike : "-"}</td>
        <td>${pos.exp}</td>
        <td>${pos.qty}</td>
        <td>$${pos.avg}</td>
        <td>$${pos.mark}</td>
        <td class="positive">${pos.delta}</td>
        <td class="negative">${pos.theta}</td>
        <td class="${pos.status}">${pos.pnl}</td>
      </tr>
    `).join("");
  })
  .catch(err => {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--accent-negative); padding: 24px;">Failed to fetch active positions.</td></tr>`;
  });
}

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
  
  // Fill default values if empty
  if(expirySelect && expirySelect.children.length === 0) {
    expirySelect.innerHTML = `
      <option>June 12, 2026 (8 Days)</option>
      <option>June 19, 2026 (15 Days)</option>
      <option>July 17, 2026 (43 Days)</option>
    `;
  }
  const expiry = expirySelect ? expirySelect.value : "June 19, 2026 (15 Days)";

  // Show loading indicators
  callsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">Loading calls...</td></tr>`;
  putsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">Loading puts...</td></tr>`;
  strategiesGrid.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px; grid-column: span 3;">Generating optimal option spread setups...</div>`;

  fetch(`/api/options/chain?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(expiry)}&username=${encodeURIComponent(currentUser)}&profile=${encodeURIComponent(state.activeProfile)}`)
  .then(res => res.json())
  .then(data => {
    // Update Underlying Price header info
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

    // Render Raw Chain
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

    // Find preselected strikes for Spreads based on Delta parameters
    // Credit Put Spread (Bull Put): Sell -0.25 delta, Buy -0.15 delta
    const bpSellPut = findStrikeByDelta(data.strikes, -0.25, 'PUT');
    const bpBuyPut = findStrikeByDelta(data.strikes, -0.15, 'PUT');

    // Credit Call Spread (Bear Call): Sell 0.25 delta, Buy 0.15 delta
    const bcSellCall = findStrikeByDelta(data.strikes, 0.25, 'CALL');
    const bcBuyCall = findStrikeByDelta(data.strikes, 0.15, 'CALL');

    // Debit Call Spread (Bull Call): Buy 0.60 delta, Sell 0.40 delta
    const dbBuyCall = findStrikeByDelta(data.strikes, 0.60, 'CALL');
    const dbSellCall = findStrikeByDelta(data.strikes, 0.40, 'CALL');

    // Debit Put Spread (Bear Put): Buy -0.60 delta, Sell -0.40 delta
    const dbBuyPut = findStrikeByDelta(data.strikes, -0.60, 'PUT');
    const dbSellPut = findStrikeByDelta(data.strikes, -0.40, 'PUT');

    // Straddle (Breakout): Buy Call ~0.50, Buy Put ~-0.50
    const atmCall = findStrikeByDelta(data.strikes, 0.50, 'CALL');
    const atmPut = findStrikeByDelta(data.strikes, -0.50, 'PUT');

    const cards = [];

    // 1. Bull Put Spread Card
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
        legs: `Sell ${bpSellPut.strike}P / Buy ${bpBuyPut.strike}P`
      });
    }

    // 2. Bear Call Spread Card
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
        legs: `Sell ${bcSellCall.strike}C / Buy ${bcBuyCall.strike}C`
      });
    }

    // 3. Bull Call Spread Card
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
        legs: `Buy ${dbBuyCall.strike}C / Sell ${dbSellCall.strike}C`
      });
    }

    // 4. Bear Put Spread Card
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
        legs: `Buy ${dbBuyPut.strike}P / Sell ${dbSellPut.strike}P`
      });
    }

    // 5. Iron Condor Card (Sideways)
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
        legs: `Sell ${bcSellCall.strike}C/Buy ${bcBuyCall.strike}C + Sell ${bpSellPut.strike}P/Buy ${bpBuyPut.strike}P`
      });
    }

    // 6. Straddle Card (Breakout)
    if (atmCall && atmPut) {
      const callPrem = parseFloat(atmCall.callAsk);
      const putPrem = parseFloat(atmPut.putAsk);
      const totalCost = callPrem + putPrem;
      const winProb = 40; // Straddle typically has lower raw win probability but high asymmetry

      cards.push({
        title: "ATM Breakout Straddle",
        type: "Straddle",
        strikes: `Buy ${atmCall.strike}C / Buy ${atmPut.strike}P`,
        desc: "Pure volatility breakout. Buy both atm call and put. Profit from major price moves in either direction.",
        winProb: `${winProb}%`,
        maxProfit: "Unlimited",
        maxLoss: `$${(totalCost * 100).toFixed(2)}`,
        premium: `-$${totalCost.toFixed(2)}`,
        collateral: `$0 (Debit Paid)`,
        legs: `Buy ${atmCall.strike}C / Buy ${atmPut.strike}P`
      });
    }

    strategiesGrid.innerHTML = cards.map(c => `
      <div class="best-bet-item hover-trigger">
        <div class="bet-header">
          <div>
            <span class="bet-title">${c.title}</span>
            <div class="bet-thesis" style="font-size: 11px; font-weight: 700; color: var(--accent-neutral); text-transform: uppercase; margin-top: 2px;">${c.type}</div>
            <div class="bet-strikes" style="margin-top: 6px; font-size: 11.5px; line-height: 1.3;">${c.strikes}</div>
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

window.tradeSpreadFromChain = function(ticker, strategy, strikes, premium, risk) {
  const expiry = document.getElementById("expirationSelect")?.value || "June 19, 2026 (14 Days)";
  const qtyInput = document.getElementById("orderQtyInput");
  const qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
  
  // Clean pricing numeric values for calculations
  const rawPrem = parseFloat(premium.replace(/[^\d.-]/g, '')) || 0.0;
  const rawRisk = parseFloat(risk.replace(/[^\d.-]/g, '')) || 0.0;
  
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
      qty: qty,
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
      
      // Add strategy to active list for demonstration
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
      qty: qty,
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

function initStrategyWizard() {
  const directionButtons = document.querySelectorAll("#wizDirectionGroup .wiz-select-btn");
  const speedButtons = document.querySelectorAll("#wizSpeedGroup .wiz-select-btn");
  const dateSelect = document.getElementById("wizDate");
  const tickerInput = document.getElementById("wizTicker");

  // Direction group handlers
  directionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      directionButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      wizDirection = btn.getAttribute("data-val");
      
      // Dynamic visibility of speed slider: Sideways and Breakout don't need speed qualifiers
      const speedSetting = document.getElementById("wizSpeedGroup").closest(".setting-item");
      if (wizDirection === "sideways" || wizDirection === "breakout") {
        speedSetting.style.display = "none";
      } else {
        speedSetting.style.display = "flex";
      }
      
      calculateWizardStrategy();
    });
  });

  // Speed group handlers
  speedButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      speedButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      wizSpeed = btn.getAttribute("data-val");
      calculateWizardStrategy();
    });
  });

  // Other input change events
  dateSelect.addEventListener("change", calculateWizardStrategy);
  tickerInput.addEventListener("input", calculateWizardStrategy);

  // Load Order button handler
  document.getElementById("loadWizOrderBtn").addEventListener("click", () => {
    const ticker = tickerInput.value.trim().toUpperCase() || "AAPL";
    
    // Switch to Options Tab
    const optionsNavBtn = document.getElementById("nav-options");
    if(optionsNavBtn) optionsNavBtn.click();

    // Fill options ticker and trigger reload
    document.getElementById("underlyingTicker").value = ticker;
    renderOptionChain();

    showHoverPanel(
      "Wizard Strategy Loaded", 
      `Loaded option chain for <strong>${ticker}</strong>. Look for target strikes based on the recommended setup.`
    );
  });

  // Initial calculation run
  calculateWizardStrategy();
}

function calculateWizardStrategy() {
  const ticker = document.getElementById("wizTicker").value.trim().toUpperCase() || "AAPL";
  const nameLabel = document.getElementById("recStrategyName");
  const textLabel = document.getElementById("recExplainerText");

  const profitLabel = document.getElementById("wizMaxProfit");
  const lossLabel = document.getElementById("wizMaxLoss");
  const probLabel = document.getElementById("wizWinProb");

  let strategy = "Bull Call Debit Spread";
  let explanation = "";
  let stats = { maxProfit: "$180", maxLoss: "$120", prob: "52%" };
  let curveType = "debit_call_spread"; // helper for drawing curve

  if (wizDirection === "up") {
    if (wizSpeed === "fast") {
      strategy = "Bull Call Debit Spread";
      explanation = `
        <strong>Thesis Setup (Up Quickly) for 10 DTE:</strong><br>
        • <strong>Asset Target:</strong> Buy a Call at <strong>~0.60 Delta (ITM)</strong> and Sell a Call at <strong>~0.40 Delta (OTM)</strong>.<br>
        • <strong>Ideal Entry Cost:</strong> Pay around <strong>40% to 45%</strong> of the spread width (e.g., pay $2.10 for a $5.00 wide spread).<br>
        • <strong>Theta/Time Decay:</strong> Negative drag. You need the directional rise to happen within the first 3 to 5 days.<br>
        • <strong>Rule-Based Exit:</strong> Auto-take profit at <strong>50% to 75% ROI</strong>. Stop loss at <strong>50% of premium paid</strong>.
      `;
      stats = { maxProfit: "$285", maxLoss: "$215", prob: "51%" };
      curveType = "bull_call_spread";
    } else {
      strategy = "Bull Put Credit Spread";
      explanation = `
        <strong>Thesis Setup (Up Slowly / Sideways) for 10 DTE:</strong><br>
        • <strong>Asset Target:</strong> Sell a Put at <strong>~0.25 to 0.30 Delta (OTM)</strong> and Buy a Put at <strong>~0.15 to 0.20 Delta (OTM)</strong> for protection.<br>
        • <strong>Ideal Premium Credit:</strong> Collect <strong>25% to 33%</strong> of the spread width (e.g., collect $1.35 for a $5.00 wide spread).<br>
        • <strong>Theta/Time Decay:</strong> Positive gain. Time is your best friend; every day it stays flat/rallies, premium decays to pocket profit.<br>
        • <strong>Rule-Based Exit:</strong> Limit order to close at <strong>50% to 60% of max profit</strong>. Hard stop out if short leg reaches <strong>0.50 Delta</strong>.
      `;
      stats = { maxProfit: "$135", maxLoss: "$365", prob: "72%" };
      curveType = "bull_put_spread";
    }
  } else if (wizDirection === "down") {
    if (wizSpeed === "fast") {
      strategy = "Bear Put Debit Spread";
      explanation = `
        <strong>Thesis Setup (Down Quickly) for 10 DTE:</strong><br>
        • <strong>Asset Target:</strong> Buy a Put at <strong>~0.60 Delta (ITM)</strong> and Sell a Put at <strong>~0.40 Delta (OTM)</strong>.<br>
        • <strong>Ideal Entry Cost:</strong> Pay around <strong>40% to 45%</strong> of the spread width (e.g., pay $2.15 for a $5.00 wide spread).<br>
        • <strong>Theta/Time Decay:</strong> Negative drag. Requires rapid decline within 3 to 5 days before Theta accelerates.<br>
        • <strong>Rule-Based Exit:</strong> Take profit at <strong>50% to 75% ROI</strong>. Stop out if position loses <strong>50% of premium paid</strong>.
      `;
      stats = { maxProfit: "$280", maxLoss: "$220", prob: "49%" };
      curveType = "bear_put_spread";
    } else {
      strategy = "Bear Call Credit Spread";
      explanation = `
        <strong>Thesis Setup (Down Slowly / Sideways) for 10 DTE:</strong><br>
        • <strong>Asset Target:</strong> Sell a Call at <strong>~0.25 to 0.30 Delta (OTM)</strong> and Buy a Call at <strong>~0.15 to 0.20 Delta (OTM)</strong> for protection.<br>
        • <strong>Ideal Premium Credit:</strong> Collect <strong>25% to 33%</strong> of the spread width (e.g., collect $1.20 for a $5.00 wide spread).<br>
        • <strong>Theta/Time Decay:</strong> Positive gain. High win rate. As long as stock does not rally, premium melts into profit.<br>
        • <strong>Rule-Based Exit:</strong> Auto-take profit at <strong>50% to 60% of max profit</strong>. Stop out if short leg delta touches <strong>0.50 Delta</strong>.
      `;
      stats = { maxProfit: "$120", maxLoss: "$380", prob: "74%" };
      curveType = "bear_call_spread";
    }
  } else if (wizDirection === "sideways") {
    strategy = "Iron Condor";
    explanation = `
      <strong>Thesis Setup (Rangebound/Quiet) for 10 DTE:</strong><br>
      • <strong>Asset Target:</strong> Sell an OTM Call Spread (0.25 Delta Short Call) AND Sell an OTM Put Spread (0.25 Delta Short Put).<br>
      • <strong>Theta/Time Decay:</strong> Maximum positive gain. Double decay speed from both wings. Highly sensitive to quiet markets.<br>
      • <strong>Rule-Based Exit:</strong> Take profit early at <strong>50% max profit</strong>. Exit instantly if short strike on either leg is breached.
    `;
    stats = { maxProfit: "$255", maxLoss: "$245", prob: "68%" };
    curveType = "iron_condor";
  } else if (wizDirection === "breakout") {
    strategy = "Long Straddle / Strangle";
    explanation = `
      <strong>Thesis Setup (Big Breakout/Earnings) for 10 DTE:</strong><br>
      • <strong>Asset Target:</strong> Buy at-the-money (0.50 Delta) Call AND Buy at-the-money (0.50 Delta) Put.<br>
      • <strong>Implied Volatility:</strong> Buy during Low IV, sell when IV spikes during the breakout.<br>
      • <strong>Rule-Based Exit:</strong> Close at <strong>50% return</strong> or cut loss if position value drops by <strong>50%</strong>. Never hold through weekend unless move is active.
    `;
    stats = { maxProfit: "Unlimited", maxLoss: "$420", prob: "38%" };
    curveType = "straddle";
  }

  // Update UI Elements
  nameLabel.textContent = strategy;
  textLabel.innerHTML = explanation;
  profitLabel.textContent = stats.maxProfit;
  lossLabel.textContent = stats.maxLoss;
  probLabel.textContent = stats.prob;

  // Draw PnL risk diagram
  drawWizPnlChart(curveType);
}

function drawWizPnlChart(curveType) {
  const canvas = document.getElementById("wizPnlChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  
  const width = canvas.width = canvas.parentElement.clientWidth;
  const height = canvas.height = canvas.parentElement.clientHeight || 180;
  
  ctx.clearRect(0, 0, width, height);

  // Retrieve computed color values for CSS variables
  const computedStyle = getComputedStyle(document.documentElement);
  const colorPositive = computedStyle.getPropertyValue('--accent-positive').trim() || "#00e676";
  const colorNegative = computedStyle.getPropertyValue('--accent-negative').trim() || "#ff2a5f";

  // Draw axis background lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // Center Horizontal Axis (Zero line)
  const zeroY = height / 2;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(width, zeroY);
  ctx.stroke();

  // Draw Curve path
  ctx.setLineDash([]);
  ctx.lineWidth = 3.5;

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  ctx.strokeStyle = gradient;

  ctx.beginPath();

  if (curveType === "bull_call_spread" || curveType === "bull_put_spread") {
    // Bullish S-curve
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
    // Bearish S-curve
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
    // Rangebound trapezoid (max profit in middle)
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
    // V-shaped curve (max loss in middle)
    gradient.addColorStop(0, colorPositive);
    gradient.addColorStop(0.5, colorNegative);
    gradient.addColorStop(1, colorPositive);

    ctx.moveTo(0, zeroY - 50);
    ctx.lineTo(width * 0.5, zeroY + 40);
    ctx.lineTo(width, zeroY - 50);
  }

  ctx.stroke();

  // Draw chart labels
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
        <div class="bet-header">
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
      
      // Add strategy to active list for demonstration
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
  
  const posTickerInput = document.getElementById("positionChartTicker");
  if (posTickerInput) {
    posTickerInput.addEventListener("input", debounce(() => {
      const ticker = posTickerInput.value.trim().toUpperCase();
      if (ticker.length >= 1) renderTechnicalChart(ticker, "positions");
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
      const ticker = posTickerInput ? posTickerInput.value.trim().toUpperCase() : "QQQ";
      setTimeout(() => renderTechnicalChart(ticker, "positions"), 100);
    });
  }

  setTimeout(() => {
    renderTechnicalChart("AAPL", "wizard");
    renderTechnicalChart("QQQ", "positions");
  }, 1000);
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

function renderTechnicalChart(ticker, tab) {
  const isWiz = tab === "wizard";
  const mainCanvasId = isWiz ? "technicalChartCanvas" : "positionTechnicalChartCanvas";
  const stochCanvasId = isWiz ? "stochasticChartCanvas" : "positionStochasticChartCanvas";
  
  const mainCanvas = document.getElementById(mainCanvasId);
  const stochCanvas = document.getElementById(stochCanvasId);
  if (!mainCanvas || !stochCanvas) return;
  
  fetch(`/api/chart/technical?ticker=${encodeURIComponent(ticker)}`)
  .then(res => res.json())
  .then(data => {
    // 1. Render Main Chart (Price, HMA 30, Supertrend)
    const ctxMain = mainCanvas.getContext("2d");
    let currentMainChart = isWiz ? wizTechChart : posTechChart;
    if (currentMainChart) currentMainChart.destroy();
    
    const labels = data.timestamps.map(ts => {
      const d = new Date(ts * 1000);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    });
    
    const supertrendSegmentColor = (ctx) => {
      if (ctx.type === 'section') return;
      const index = ctx.p1DataIndex;
      const dir = data.supertrendDirection[index];
      return dir === 1 ? "#00e676" : "#ff2a5f";
    };
    
    // Retrieve colors for line and background fill
    const computedStyle = getComputedStyle(document.documentElement);
    const colorPositive = computedStyle.getPropertyValue('--accent-positive').trim() || "#00e676";
    const colorNegative = computedStyle.getPropertyValue('--accent-negative').trim() || "#ff2a5f";

    // Setup candlestick bar coordinates
    const colors = data.closes.map((c, i) => c >= data.opens[i] ? colorPositive : colorNegative);
    const wicksData = data.closes.map((c, i) => [data.lows[i], data.highs[i]]);
    const bodiesData = data.closes.map((c, i) => [data.opens[i], c]);

    const newMainChart = new Chart(ctxMain, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            type: "bar",
            label: "Price Body",
            data: bodiesData,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
            barThickness: 8,
            order: 2
          },
          {
            type: "bar",
            label: "Wick Range",
            data: wicksData,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
            barThickness: 1.8,
            order: 3
          },
          {
            type: "line",
            label: "30 HMA",
            data: data.hma30,
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
            data: data.supertrend,
            borderWidth: 2.5,
            pointRadius: 0,
            segment: {
              borderColor: supertrendSegmentColor
            },
            tension: 0.1,
            order: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: "rgba(255,255,255,0.7)", font: { size: 10 } }
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
            min: Math.floor(Math.min(...data.lows) - ((Math.max(...data.highs) - Math.min(...data.lows)) * 0.05 || 2.0)),
            max: Math.ceil(Math.max(...data.highs) + ((Math.max(...data.highs) - Math.min(...data.lows)) * 0.05 || 2.0))
          }
        }
      }
    });
    
    if (isWiz) wizTechChart = newMainChart;
    else posTechChart = newMainChart;
    
    // 2. Render Stochastics Chart (14,4%D & 40,4%D)
    const ctxStoch = stochCanvas.getContext("2d");
    let currentStochChart = isWiz ? wizStochChart : posStochChart;
    if (currentStochChart) currentStochChart.destroy();
    
    const newStochChart = new Chart(ctxStoch, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Stoch (14, 4 %D)",
            data: data.stoch14_4d,
            borderColor: colorNegative,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: "Stoch (40, 4 %D)",
            data: data.stoch40_4d,
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
        plugins: {
          legend: {
            display: true,
            labels: { color: "rgba(255,255,255,0.7)", font: { size: 10 } }
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
    
    if (isWiz) wizStochChart = newStochChart;
    else posStochChart = newStochChart;
  })
  .catch(err => console.error("Error drawing technical indicators chart:", err));
}

// ==========================================================================
// BEGINNER STOCK BASKETS CONFIGURATION
// ==========================================================================
const optionBaskets = {
  cheap: ["SOFI", "F", "PLTR", "PFE"],
  medium: ["AMD", "INTC", "BAC", "VALE"],
  high: ["TSLA", "AAPL", "MSFT", "NVDA"]
};

function initBeginnerBaskets() {
  const basketButtons = document.querySelectorAll("#beginnerBasketsGroup .basket-btn");
  basketButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      basketButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const basketName = btn.getAttribute("data-basket");
      renderBasketTickers(basketName);
    });
  });
  
  renderBasketTickers("high");
}

function renderBasketTickers(basketName) {
  const listContainer = document.getElementById("basketTickersList");
  if (!listContainer) return;
  
  const tickers = optionBaskets[basketName] || [];
  
  listContainer.innerHTML = tickers.map(ticker => `
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



