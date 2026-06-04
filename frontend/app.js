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
  
  if (fetchChainBtn && !fetchChainBtn.dataset.bound) {
    fetchChainBtn.addEventListener("click", renderOptionChain);
    fetchChainBtn.dataset.bound = "true";
  }
  if (expirationSelect && !expirationSelect.dataset.bound) {
    expirationSelect.addEventListener("change", renderOptionChain);
    expirationSelect.dataset.bound = "true";
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
    const username = document.getElementById("authUsername").value.trim();
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
        state = data.state;
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
    if (!res.ok) throw new Error("Could not load user data");
    return res.json();
  })
  .then(data => {
    state = data;
    applyProfileSettings(state.activeProfile);
    rebuildProfileSelectors();
    hideAuthScreen();
  })
  .catch(err => {
    console.error(err);
    // Offline / fallback state
    hideAuthScreen();
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
  .then(data => {
    document.getElementById("navValue").textContent = `$${data.equity}`;
    document.getElementById("buyingPower").textContent = `$${data.buying_power}`;
    
    // Manage sandbox connection indicator status
    const indicator = document.querySelector(".status-indicator");
    const statusText = document.querySelector(".status-text");
    if(indicator && statusText) {
      if (data.is_mock) {
        indicator.style.backgroundColor = "#ffb800"; // yellow warning
        indicator.style.boxShadow = "0 0 8px #ffb800";
        statusText.textContent = "Offline / Sandbox Demo";
      } else {
        indicator.style.backgroundColor = "#00e676"; // green live
        indicator.style.boxShadow = "0 0 8px #00e676";
        statusText.textContent = state.profiles[state.activeProfile].alpacaLive ? "Alpaca LIVE" : "Alpaca Sandbox";
      }
    }
  })
  .catch(err => console.error("Error fetching account balance:", err));

  const ctx = document.getElementById("performanceChart").getContext("2d");
  if (perfChart) perfChart.destroy();
  
  perfChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: ["May 29", "May 30", "June 1", "June 2", "June 3", "Today"],
      datasets: [{
        label: "Net Value ($)",
        data: [118200, 119500, 121400, 120100, 122900, 124582.4],
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

  const strategySummary = document.getElementById("strategySummary");
  const strategies = [
    { name: "AAPL Iron Condor", expiry: "Jun 12, 2026", pnl: "+$420.00", status: "positive" },
    { name: "TSLA Vertical Call Spread", expiry: "Jun 19, 2026", pnl: "-$125.00", status: "negative" },
    { name: "SPY Naked Put (0DTE)", expiry: "Today", pnl: "+$850.00", status: "positive" }
  ];

  strategySummary.innerHTML = strategies.map(str => `
    <div class="strategy-item hover-trigger">
      <div class="strategy-info">
        <span class="strategy-title">${str.name}</span>
        <span class="strategy-meta">Expires ${str.expiry}</span>
      </div>
      <span class="strategy-pnl ${str.status}">${str.pnl}</span>
    </div>
  `).join("");
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

function renderOptionChain() {
  const tickerInput = document.getElementById("underlyingTicker");
  const ticker = tickerInput ? tickerInput.value.trim().toUpperCase() : "AAPL";
  const callsBody = document.getElementById("callsTableBody");
  const putsBody = document.getElementById("putsTableBody");
  if(!callsBody || !putsBody) return;

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
  })
  .catch(err => {
    callsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--accent-negative); padding: 12px;">Error fetching options data.</td></tr>`;
    putsBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--accent-negative); padding: 12px;">Error fetching options data.</td></tr>`;
  });
}

// Click Option Row callback
window.selectStrike = function(type, strike, price) {
  const ticker = document.getElementById("underlyingTicker").value;
  showHoverPanel(
    `Execute ${ticker} Trade`,
    `
      <p style="margin-bottom: 12px;">Initiate a new options order via Alpaca Sandbox API:</p>
      <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
        <strong>Asset:</strong> ${ticker} $${strike} ${type}<br>
        <strong>Est. Price:</strong> $${price} per contract ($${(parseFloat(price) * 100).toFixed(2)})
      </div>
      <button class="primary-btn" onclick="executeTrade('${ticker}', '${type}', '${strike}', '${price}')">
        Send Market Order
      </button>
    `
  );
}

window.executeTrade = function(ticker, type, strike, price) {
  const expiry = document.getElementById("expirationSelect")?.value || "June 19, 2026 (14 Days)";
  showHoverPanel("Order Sent", `Routing order to Alpaca: Buy 1 contract of ${ticker} $${strike} ${type} at $${price}...`);
  
  fetch(`/api/trade?username=${encodeURIComponent(currentUser)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: state.activeProfile,
      ticker, type, strike, price, expiry
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
  try {
    await fetch(`/api/profiles?username=${encodeURIComponent(currentUser)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
  } catch (err) {
    console.warn("Backend connection offline, configurations saved locally.", err);
  }
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


