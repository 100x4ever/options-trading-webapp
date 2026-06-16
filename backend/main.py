import os
import json
import requests
import uuid
import hashlib
import re
import math
import threading
import time
from datetime import date
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

# Alpaca Client imports
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import LimitOrderRequest, OptionLegRequest, MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass, PositionIntent

app = FastAPI(title="AuraTrade Backend Server")

# Define directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# FIXED: Points inside the isolated persistent folder volume so it doesn't mask /app
PERSISTENT_VOLUME_DIR = "/app/data"
DATA_FILE = os.path.join(PERSISTENT_VOLUME_DIR, "profiles_db.json")

# Automatically initialize directory path if it's running fresh on a new volume mount
if not os.path.exists(PERSISTENT_VOLUME_DIR):
    os.makedirs(PERSISTENT_VOLUME_DIR, exist_ok=True)

# One-time startup database cleanup to clear user memory and allow fresh signup
try:
    db = read_db()
    if "users" in db:
        if "jcollz" in db["users"]:
            del db["users"]["jcollz"]
            write_db(db)
            print("Successfully cleared jcollz from database.")
except Exception as e:
    print("Database cleanup error:", e)

# Data Models
class AuthModel(BaseModel):
    username: str
    password: str

class StateModel(BaseModel):
    profiles: Dict[str, Any]
    activeProfile: str

class TradeModel(BaseModel):
    profile: str
    ticker: str
    type: str
    strike: str
    price: str
    qty: Optional[int] = 1
    expiry: Optional[str] = "June 19, 2026 (14 Days)"

# Helper to read database
def read_db() -> Dict[str, Any]:
    if not os.path.exists(DATA_FILE):
        return {"users": {}}
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"users": {}}

# Helper to write database
def write_db(data: Dict[str, Any]):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

# Simple Password Hashing
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

# Date parser to YYMMDD OSI format
def format_date_to_yymmdd(expiry_str: str) -> str:
    expiry_str = expiry_str.strip()
    if len(expiry_str) == 6 and expiry_str.isdigit():
        return expiry_str
        
    months = {
        "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
        "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
        "january": "01", "february": "02", "march": "03", "april": "04", "june": "06",
        "july": "07", "august": "08", "september": "09", "october": "10", "november": "11", "december": "12"
    }
    
    y_val, m_val, d_val = "26", "06", "19" # Default fallback June 19, 2026
    
    # Try regex match for "Month Day, Year" e.g., "June 19, 2026"
    match = re.search(r'([A-Za-z]+)\s+(\d+),\s*(\d{4})', expiry_str)
    if match:
        m_name, day, year = match.groups()
        m_val = months.get(m_name.lower(), "06")
        y_val = year[2:]
        d_val = f"{int(day):02d}"
    else:
        # Check if short format like "Jun 19"
        match_short = re.search(r'([A-Za-z]+)\s+(\d+)', expiry_str)
        if match_short:
            m_name, day = match_short.groups()
            m_val = months.get(m_name.lower(), "06")
            y_val = "26" # Default current year 2026
            d_val = f"{int(day):02d}"
            
    return f"{y_val}{m_val}{d_val}"

# Convert option details to standard Alpaca option symbol format
def format_osi_symbol(ticker: str, expiry_yymmdd: str, option_type: str, strike_val: float) -> str:
    ticker_clean = ticker.strip().upper()
    type_char = "C" if "c" in option_type.lower() else "P"
    
    dollars = int(strike_val)
    cents = int(round((strike_val - dollars) * 1000))
    strike_formatted = f"{dollars:05d}{cents:03d}"
    
    return f"{ticker_clean}{expiry_yymmdd}{type_char}{strike_formatted}"

# Auto-detect Live vs Paper Alpaca API keys based on prefix
def check_is_live(api_key: Optional[str], default_live: bool = False) -> bool:
    if not api_key:
        return default_live
    api_key_clean = api_key.strip()
    if api_key_clean.startswith("AK"):
        return True
    if api_key_clean.startswith("PK"):
        return False
    return default_live

# Black-Scholes Greeks Engine
def normal_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

def normal_pdf(x):
    return math.exp(-0.5 * x**2) / math.sqrt(2.0 * math.pi)

def calculate_greeks(s, k, t, r, sigma, option_type="call"):
    t = max(0.0001, t)
    
    d1 = (math.log(s / k) + (r + 0.5 * sigma**2) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    
    n_d1 = normal_cdf(d1)
    n_d2 = normal_cdf(d2)
    pdf_d1 = normal_pdf(d1)
    
    if option_type.lower() == "call":
        price = s * n_d1 - k * math.exp(-r * t) * n_d2
        delta = n_d1
        theta = (- (s * pdf_d1 * sigma) / (2 * math.sqrt(t)) - r * k * math.exp(-r * t) * n_d2) / 365.0
    else:
        price = k * math.exp(-r * t) * normal_cdf(-d2) - s * normal_cdf(-d1)
        delta = n_d1 - 1.0
        theta = (- (s * pdf_d1 * sigma) / (2 * math.sqrt(t)) + r * k * math.exp(-r * t) * normal_cdf(-d2)) / 365.0
        
    gamma = pdf_d1 / (s * sigma * math.sqrt(t))
    
    return {
        "price": max(0.01, round(price, 2)),
        "delta": round(delta, 2),
        "theta": round(theta, 2),
        "gamma": round(gamma, 4)
    }

# Authentication Endpoints
@app.post("/api/auth/register")
def register(auth: AuthModel):
    db = read_db()
    username = auth.username.strip().lower()
    if not username or not auth.password:
        raise HTTPException(status_code=400, detail="Username and password cannot be empty")
    
    if username in db.get("users", {}):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    env_key = os.environ.get("ALPACA_API_KEY", "")
    env_secret = os.environ.get("ALPACA_SECRET_KEY", "")
    env_live = check_is_live(env_key, False)

    default_state = {
        "profiles": {
            "Default User": {
                "glassColor": "#121520",
                "glassOpacity": "0.45",
                "glassBlur": "20px",
                "glassBorderOpacity": "0.15",
                "blobColor1": "#ff2a5f",
                "blobColor2": "#00f0ff",
                "blobColor3": "#7000ff",
                "blobColor4": "#ffb800",
                "lampSpeed": "1.0",
                "alpacaApiKey": env_key,
                "alpacaSecretKey": env_secret,
                "alpacaLive": env_live,
                "active_trades": []
            }
        },
        "activeProfile": "Default User"
    }

    if "users" not in db:
        db["users"] = {}
        
    db["users"][username] = {
        "password": hash_password(auth.password),
        "state": default_state
    }
    write_db(db)
    return {"status": "success", "message": "User registered successfully"}

@app.post("/api/auth/login")
def login(auth: AuthModel):
    db = read_db()
    username = auth.username.strip().lower()
    user = db.get("users", {}).get(username)
    
    if not user or user.get("password") != hash_password(auth.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    return {"status": "success", "username": username, "state": user.get("state")}

# User Profiles and Configuration
@app.get("/api/profiles")
def get_profiles(username: str):
    db = read_db()
    user = db.get("users", {}).get(username.lower())
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user.get("state")

@app.post("/api/profiles")
def save_profiles(state: StateModel, username: str):
    db = read_db()
    username_lower = username.lower().strip()
    if username_lower == "gang":
        raise HTTPException(status_code=403, detail="The public 'gang' account is read-only.")
    if username_lower not in db.get("users", {}):
        raise HTTPException(status_code=404, detail="User not found")
        
    db["users"][username_lower]["state"] = state.dict()
    write_db(db)
    return {"status": "success", "message": "Configurations saved"}

# Retrieve Live Alpaca Account Details
@app.get("/api/account")
def get_alpaca_account(username: str, profile: str):
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Profile not found")

    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        return {
            "equity": "0.00",
            "buying_power": "0.00",
            "is_mock": True
        }

    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        account = trading_client.get_account()
        return {
            "equity": f"{float(account.equity):.2f}",
            "buying_power": f"{float(account.options_buying_power):.2f}",
            "is_mock": False
        }
    except Exception as e:
        return {
            "equity": "0.00",
            "buying_power": "0.00",
            "is_mock": True,
            "error": str(e)
        }

def get_underlying_price(ticker: str) -> float:
    ticker_upper = ticker.strip().upper()
    fallbacks = {"QQQ": 740.0, "AAPL": 310.0, "TSLA": 180.0, "MSFT": 420.0, "NVDA": 120.0}
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker_upper}"
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.get(url, headers=headers, timeout=3)
        if res.status_code == 200:
            return float(res.json()["chart"]["result"][0]["meta"]["regularMarketPrice"])
    except Exception:
        pass
    return fallbacks.get(ticker_upper, 150.0)

# Retrieve Live Positions Table
@app.get("/api/positions")
def get_alpaca_positions(username: str, profile: str):
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Profile not found")

    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        return []

    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        positions = trading_client.get_all_positions()
        
        underlying_prices = {}
        r = 0.045
        sigma = 0.22

        parsed_options = []
        other_positions = []
        
        for pos in positions:
            symbol = pos.symbol
            match = re.match(r'^([A-Z]{1,6})(\d{6})([CP])(\d{8})$', symbol)
            if match:
                ticker, expiry_yymmdd, side_char, strike_raw = match.groups()
                opt_type = "CALL" if side_char == "C" else "PUT"
                strike_val = float(strike_raw) / 1000.0
                qty = int(pos.qty)
                side = "buy" if qty > 0 else "sell"
                
                try:
                    exp_date = date(2000 + int(expiry_yymmdd[0:2]), int(expiry_yymmdd[2:4]), int(expiry_yymmdd[4:6]))
                    dte = max(1, (exp_date - date.today()).days)
                except Exception:
                    dte = 10
                t = dte / 365.0

                if ticker not in underlying_prices:
                    underlying_prices[ticker] = get_underlying_price(ticker)
                s = underlying_prices[ticker]

                leg_greeks = calculate_greeks(s, strike_val, t, r, sigma, opt_type)

                parsed_options.append({
                    "pos": pos,
                    "symbol": symbol,
                    "ticker": ticker,
                    "expiry_yymmdd": expiry_yymmdd,
                    "type": opt_type,
                    "strike": strike_val,
                    "qty": abs(qty),
                    "side": side,
                    "unrealized_pl": float(pos.unrealized_pl),
                    "avg_entry_price": float(pos.avg_entry_price),
                    "current_price": float(pos.current_price),
                    "delta": leg_greeks["delta"],
                    "gamma": leg_greeks["gamma"],
                    "theta": leg_greeks["theta"]
                })
            else:
                other_positions.append(pos)
                
        groups = {}
        for opt in parsed_options:
            key = (opt["ticker"], opt["expiry_yymmdd"])
            if key not in groups:
                groups[key] = []
            groups[key].append(opt)
            
        formatted_positions = []
        matched_symbols = set()
        active_trades = profile_data.get("active_trades", [])

        # Helper to match positions with locally registered active trades
        def find_active_trade(ticker, expiry_yymmdd, strategy_type, strike_val=None):
            for t in active_trades:
                if t["ticker"] == ticker.upper():
                    if format_date_to_yymmdd(t["expiry"]) == expiry_yymmdd:
                        if strike_val is not None:
                            try:
                                strike_str_clean = t["strike_str"].replace("$", "").strip()
                                if f"{strike_val:.2f}" in strike_str_clean:
                                    return t
                            except Exception:
                                pass
                        else:
                            # Loose match on strategy name
                            if t["strategy"].lower() == strategy_type.lower() or strategy_type.lower() in t["strategy"].lower():
                                return t
            return None
        
        for (ticker, expiry_yymmdd), legs in groups.items():
            legs.sort(key=lambda x: x["strike"])
            used_indices = set()
            
            i = 0
            while i < len(legs):
                if i in used_indices:
                    i += 1
                    continue
                q = legs[i]["qty"]
                
                candidates = [idx for idx, leg in enumerate(legs) if idx not in used_indices and leg["qty"] == q]
                if len(candidates) >= 4:
                    from itertools import combinations
                    found_condor = False
                    for comb in combinations(candidates, 4):
                        comb_legs = [legs[idx] for idx in comb]
                        puts = [l for l in comb_legs if l["type"] == "PUT"]
                        calls = [l for l in comb_legs if l["type"] == "CALL"]
                        if len(puts) == 2 and len(calls) == 2:
                            if (puts[0]["side"] != puts[1]["side"]) and (calls[0]["side"] != calls[1]["side"]):
                                puts.sort(key=lambda x: x["strike"])
                                calls.sort(key=lambda x: x["strike"])
                                
                                short_put = puts[1] if puts[1]["side"] == "sell" else puts[0]
                                long_put = puts[0] if puts[1]["side"] == "sell" else puts[1]
                                
                                short_call = calls[0] if calls[0]["side"] == "sell" else calls[1]
                                long_call = calls[1] if calls[0]["side"] == "sell" else calls[0]
                                
                                strike_str = f"Sell {short_call['strike']:.2f}C/Buy {long_call['strike']:.2f}C + Sell {short_put['strike']:.2f}P/Buy {long_put['strike']:.2f}P"
                                
                                total_pnl = sum(l["unrealized_pl"] for l in comb_legs)
                                pnl_str = f"+${total_pnl:.2f}" if total_pnl >= 0 else f"-${abs(total_pnl):.2f}"
                                exp_clean = f"{expiry_yymmdd[2:4]}/{expiry_yymmdd[4:6]}"
                                
                                total_delta = sum(l["delta"] * (1.0 if l["side"] == "buy" else -1.0) for l in comb_legs) * q
                                total_gamma = sum(l["gamma"] * (1.0 if l["side"] == "buy" else -1.0) for l in comb_legs) * q
                                total_theta = sum(l["theta"] * (1.0 if l["side"] == "buy" else -1.0) for l in comb_legs) * q

                                # Calculate net value (mark price of the spread)
                                net_val = sum(l["current_price"] * (1.0 if l["side"] == "buy" else -1.0) for l in comb_legs)

                                matching_trade = find_active_trade(ticker, expiry_yymmdd, "Iron Condor")
                                entry_p = float(matching_trade["entry_price"]) if matching_trade else 1.00
                                is_cr = True
                                current_c = -net_val
                                profit_t = entry_p * 0.50
                                stop_l = entry_p * 2.00

                                formatted_positions.append({
                                    "ticker": ticker,
                                    "type": "Iron Condor",
                                    "strike": strike_str,
                                    "exp": exp_clean,
                                    "expiry_yymmdd": expiry_yymmdd,
                                    "qty": q,
                                    "avg": f"{entry_p:.2f}" if matching_trade else "-",
                                    "mark": f"{abs(net_val):.2f}",
                                    "delta": f"{total_delta:+.2f}",
                                    "gamma": f"{total_gamma:+.4f}",
                                    "theta": f"{total_theta:+.2f}",
                                    "pnl": pnl_str,
                                    "status": "positive" if total_pnl >= 0 else "negative",
                                    "entry_price": entry_p,
                                    "current_value": current_c,
                                    "is_credit": is_cr,
                                    "profit_target": profit_t,
                                    "stop_loss": stop_l,
                                    "breakevens": [
                                        {"price": round(short_put["strike"] - entry_p, 2), "direction": "above"},
                                        {"price": round(short_call["strike"] + entry_p, 2), "direction": "under"}
                                    ]
                                })
                                
                                for idx in comb:
                                    used_indices.add(idx)
                                    matched_symbols.add(legs[idx]["symbol"])
                                found_condor = True
                                break
                    if found_condor:
                        continue
                i += 1
                
            i = 0
            while i < len(legs):
                if i in used_indices:
                    i += 1
                    continue
                q = legs[i]["qty"]
                t = legs[i]["type"]
                s = legs[i]["side"]
                
                found_match = False
                for j in range(i + 1, len(legs)):
                    if j in used_indices:
                        continue
                    if legs[j]["qty"] == q and legs[j]["type"] == t and legs[j]["side"] != s:
                        leg1 = legs[i]
                        leg2 = legs[j]
                        
                        buy_leg = leg1 if leg1["side"] == "buy" else leg2
                        sell_leg = leg1 if leg1["side"] == "sell" else leg2
                        
                        if t == "CALL":
                            strat_name = "Bull Call Spread" if buy_leg["strike"] < sell_leg["strike"] else "Bear Call Spread"
                            strike_str = f"Buy {buy_leg['strike']:.2f}C / Sell {sell_leg['strike']:.2f}C"
                        else:
                            strat_name = "Bear Put Spread" if buy_leg["strike"] > sell_leg["strike"] else "Bull Put Spread"
                            strike_str = f"Sell {sell_leg['strike']:.2f}P / Buy {buy_leg['strike']:.2f}P"
                            
                        total_pnl = leg1["unrealized_pl"] + leg2["unrealized_pl"]
                        pnl_str = f"+${total_pnl:.2f}" if total_pnl >= 0 else f"-${abs(total_pnl):.2f}"
                        exp_clean = f"{expiry_yymmdd[2:4]}/{expiry_yymmdd[4:6]}"
                        
                        total_delta = sum(l["delta"] * (1.0 if l["side"] == "buy" else -1.0) for l in [leg1, leg2]) * q
                        total_gamma = sum(l["gamma"] * (1.0 if l["side"] == "buy" else -1.0) for l in [leg1, leg2]) * q
                        total_theta = sum(l["theta"] * (1.0 if l["side"] == "buy" else -1.0) for l in [leg1, leg2]) * q

                        # Calculate net value (mark price of the spread)
                        net_val = sum(l["current_price"] * (1.0 if l["side"] == "buy" else -1.0) for l in [leg1, leg2])

                        matching_trade = find_active_trade(ticker, expiry_yymmdd, strat_name)
                        entry_p = float(matching_trade["entry_price"]) if matching_trade else 1.00
                        is_cr = "credit" in strat_name.lower() or "condor" in strat_name.lower()
                        
                        if is_cr:
                            current_c = -net_val
                            profit_t = entry_p * 0.50
                            stop_l = entry_p * 2.00
                            cur_val_to_send = -net_val
                        else:
                            current_c = net_val
                            profit_t = entry_p * 1.50
                            stop_l = entry_p * 0.50
                            cur_val_to_send = net_val

                        be_val = 0.0
                        be_dir = "above"
                        if strat_name == "Bull Call Spread":
                            be_val = buy_leg['strike'] + entry_p
                            be_dir = "above"
                        elif strat_name == "Bear Call Spread":
                            be_val = sell_leg['strike'] + entry_p
                            be_dir = "under"
                        elif strat_name == "Bear Put Spread":
                            be_val = buy_leg['strike'] - entry_p
                            be_dir = "under"
                        elif strat_name == "Bull Put Spread":
                            be_val = sell_leg['strike'] - entry_p
                            be_dir = "above"

                        formatted_positions.append({
                            "ticker": ticker,
                            "type": strat_name,
                            "strike": strike_str,
                            "exp": exp_clean,
                            "expiry_yymmdd": expiry_yymmdd,
                            "qty": q,
                            "avg": f"{entry_p:.2f}" if matching_trade else "-",
                            "mark": f"{abs(net_val):.2f}",
                            "delta": f"{total_delta:+.2f}",
                            "gamma": f"{total_gamma:+.4f}",
                            "theta": f"{total_theta:+.2f}",
                            "pnl": pnl_str,
                            "status": "positive" if total_pnl >= 0 else "negative",
                            "entry_price": entry_p,
                            "current_value": cur_val_to_send,
                            "is_credit": is_cr,
                            "profit_target": profit_t,
                            "stop_loss": stop_l,
                            "breakevens": [{"price": round(be_val, 2), "direction": be_dir}]
                        })
                        
                        used_indices.add(i)
                        used_indices.add(j)
                        matched_symbols.add(leg1["symbol"])
                        matched_symbols.add(leg2["symbol"])
                        found_match = True
                        break
                if found_match:
                    continue
                i += 1
                
            for idx, leg in enumerate(legs):
                if idx not in used_indices:
                    pos = leg["pos"]
                    strike_val = leg["strike"]
                    exp_clean = f"{expiry_yymmdd[2:4]}/{expiry_yymmdd[4:6]}"
                    pnl_val = leg["unrealized_pl"]
                    pnl_str = f"+${pnl_val:.2f}" if pnl_val >= 0 else f"-${abs(pnl_val):.2f}"
                    
                    leg_qty = int(pos.qty)
                    total_delta = leg["delta"] * leg_qty
                    total_gamma = leg["gamma"] * leg_qty
                    total_theta = leg["theta"] * leg_qty

                    matching_trade = find_active_trade(ticker, expiry_yymmdd, "Call" if leg["type"] == "CALL" else "Put", strike_val)
                    entry_p = float(matching_trade["entry_price"]) if matching_trade else float(leg['avg_entry_price'])
                    is_cr = leg_qty < 0
                    net_val = float(leg['current_price'])
                    
                    if is_cr:
                        profit_t = entry_p * 0.50
                        stop_l = entry_p * 2.00
                        cur_val_to_send = net_val
                    else:
                        profit_t = entry_p * 1.50
                        stop_l = entry_p * 0.50
                        cur_val_to_send = net_val

                    be_val = 0.0
                    be_dir = "above"
                    is_buy = (leg_qty > 0)
                    if leg["type"] == "CALL":
                        be_val = strike_val + entry_p
                        be_dir = "above" if is_buy else "under"
                    else:
                        be_val = strike_val - entry_p
                        be_dir = "under" if is_buy else "above"

                    formatted_positions.append({
                        "ticker": ticker,
                        "type": "Call" if leg["type"] == "CALL" else "Put",
                        "strike": f"{strike_val:.2f}",
                        "exp": exp_clean,
                        "expiry_yymmdd": expiry_yymmdd,
                        "qty": leg_qty,
                        "avg": f"{entry_p:.2f}",
                        "mark": f"{net_val:.2f}",
                        "delta": f"{total_delta:+.2f}",
                        "gamma": f"{total_gamma:+.4f}",
                        "theta": f"{total_theta:+.2f}",
                        "pnl": pnl_str,
                        "status": "positive" if pnl_val >= 0 else "negative",
                        "entry_price": entry_p,
                        "current_value": cur_val_to_send,
                        "is_credit": is_cr,
                        "profit_target": profit_t,
                        "stop_loss": stop_l,
                        "breakevens": [{"price": round(be_val, 2), "direction": be_dir}]
                    })
                    
        for pos in other_positions:
            pnl_val = float(pos.unrealized_pl)
            pnl_str = f"+${pnl_val:.2f}" if pnl_val >= 0 else f"-${abs(pnl_val):.2f}"
            
            qty_val = int(pos.qty)
            formatted_positions.append({
                "ticker": pos.symbol,
                "type": "Stock",
                "strike": "-",
                "exp": "-",
                "qty": qty_val,
                "avg": f"{float(pos.avg_entry_price):.2f}",
                "mark": f"{float(pos.current_price):.2f}",
                "delta": f"{1.0 * qty_val:+.2f}",
                "gamma": "+0.0000",
                "theta": "+0.00",
                "pnl": pnl_str,
                "status": "positive" if pnl_val >= 0 else "negative"
            })
            
        return formatted_positions
    except Exception:
        return []

# Retrieve Live Alpaca Portfolio History
@app.get("/api/portfolio/history")
def get_portfolio_history(username: str, profile: str):
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Profile not found")

    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        return {
            "timestamp": [],
            "equity": [],
            "profit_loss": [],
            "profit_loss_pct": []
        }

    try:
        base_url = "https://api.alpaca.markets" if is_live else "https://paper-api.alpaca.markets"
        headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret_key
        }
        res = requests.get(f"{base_url}/v2/account/portfolio/history?period=1M&timeframe=1D", headers=headers, timeout=5)
        if res.status_code == 200:
            return res.json()
        return {
            "timestamp": [],
            "equity": [],
            "profit_loss": [],
            "profit_loss_pct": []
        }
    except Exception:
        return {
            "timestamp": [],
            "equity": [],
            "profit_loss": [],
            "profit_loss_pct": []
        }

# Get Real Option Chain Data & Greeks for ANY Searched Ticker
@app.get("/api/options/chain")
def get_options_chain(ticker: str, expiry: str, username: str, profile: str):
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(profile, {})
    
    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))
    
    ticker_upper = ticker.strip().upper()
    underlying_price = None
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker_upper}"
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            data = res.json()
            underlying_price = float(data["chart"]["result"][0]["meta"]["regularMarketPrice"])
    except Exception:
        pass

    if underlying_price is None and api_key and secret_key:
        try:
            from alpaca.data.historical import StockHistoricalDataClient
            from alpaca.data.requests import StockLatestTradeRequest
            
            data_client = StockHistoricalDataClient(api_key, secret_key)
            trade_req = StockLatestTradeRequest(symbol_or_symbols=ticker_upper)
            trade_res = data_client.get_stock_latest_trade(trade_req)
            if ticker_upper in trade_res:
                underlying_price = float(trade_res[ticker_upper].price)
        except Exception:
            pass

    if underlying_price is None:
        if ticker_upper == "QQQ":
            underlying_price = 740.0
        elif ticker_upper == "AAPL":
            underlying_price = 310.0
        else:
            underlying_price = 180.0

    yymmdd = format_date_to_yymmdd(expiry)
    try:
        exp_date = date(2000 + int(yymmdd[0:2]), int(yymmdd[2:4]), int(yymmdd[4:6]))
        dte = max(1, (exp_date - date.today()).days)
    except Exception:
        dte = 10
        
    t = dte / 365.0
    r = 0.045 
    sigma = 0.22 
    
    if ticker_upper == "QQQ":
        step = 1.0
    elif underlying_price > 500:
        step = 10
    elif underlying_price > 150:
        step = 5
    elif underlying_price > 50:
        step = 2.5
    else:
        step = 1
        
    atm_strike = round(underlying_price / step) * step
    
    if ticker_upper == "QQQ":
        strikes_list = [atm_strike + i * step for i in range(-15, 16)]
    else:
        strikes_list = [atm_strike + i * step for i in range(-4, 5)]
    
    strikes_data = []
    for strike in strikes_list:
        c_greeks = calculate_greeks(underlying_price, strike, t, r, sigma, "call")
        p_greeks = calculate_greeks(underlying_price, strike, t, r, sigma, "put")
        
        spread = max(0.02, round(c_greeks["price"] * 0.03, 2))
        call_bid = max(0.01, round(c_greeks["price"] - spread/2, 2))
        call_ask = round(c_greeks["price"] + spread/2, 2)
        
        p_spread = max(0.02, round(p_greeks["price"] * 0.03, 2))
        put_bid = max(0.01, round(p_greeks["price"] - p_spread/2, 2))
        put_ask = round(p_greeks["price"] + p_spread/2, 2)
        
        strikes_data.append({
            "strike": f"{strike:.2f}",
            "callBid": f"{call_bid:.2f}",
            "callAsk": f"{call_ask:.2f}",
            "callDelta": f"{c_greeks['delta']:.2f}",
            "callTheta": f"{c_greeks['theta']:.2f}",
            "putBid": f"{put_bid:.2f}",
            "putAsk": f"{put_ask:.2f}",
            "putDelta": f"{p_greeks['delta']:.2f}",
            "putTheta": f"{p_greeks['theta']:.2f}"
        })
        
    return {
        "ticker": ticker_upper,
        "underlyingPrice": round(underlying_price, 2),
        "expiry": expiry,
        "dte": dte,
        "strikes": strikes_data
    }

def update_trade_order_id(username: str, profile_name: str, ticker: str, strike_str: str, old_order_id: str, new_order_id: str, fill_price: float = None):
    try:
        db = read_db()
        user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
        profile_data = user_state.get("profiles", {}).get(profile_name)
        if not profile_data:
            return
        active_trades = profile_data.get("active_trades", [])
        for t in active_trades:
            if t["ticker"] == ticker.upper() and t["strike_str"] == strike_str and t["order_id"] == old_order_id:
                t["order_id"] = new_order_id
                if fill_price is not None:
                    t["entry_price"] = fill_price
                break
        db["users"][username.lower()]["state"] = user_state
        write_db(db)
        print(f"[Price-Walking] Updated trade registry: ticker={ticker}, old_id={old_order_id} -> new_id={new_order_id}")
    except Exception as e:
        print(f"[Price-Walking] Error updating trade registry: {e}")

def remove_trade_by_order_id(username: str, profile_name: str, order_id: str):
    try:
        db = read_db()
        user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
        profile_data = user_state.get("profiles", {}).get(profile_name)
        if not profile_data:
            return
        active_trades = profile_data.get("active_trades", [])
        profile_data["active_trades"] = [t for t in active_trades if t["order_id"] != order_id]
        db["users"][username.lower()]["state"] = user_state
        write_db(db)
        print(f"[Price-Walking] Removed cancelled/rejected trade registry entry for order_id={order_id}")
    except Exception as e:
        print(f"[Price-Walking] Error removing trade registry entry: {e}")

def work_order_chase(username: str, profile_name: str, ticker: str, strike_str: str, steps: list, qty: int, api_key: str, secret_key: str, is_live: bool, order_request: LimitOrderRequest):
    trading_client = TradingClient(api_key, secret_key, paper=not is_live)
    current_order_id = "working"
    
    for i, target_price in enumerate(steps):
        # Update limit price for this step
        order_request.limit_price = target_price
        
        # Submit the order
        try:
            order = trading_client.submit_order(order_request)
            new_order_id = str(order.id)
            print(f"[Price-Walking] Placed order step {i+1}/4: limit_price={target_price:.2f}, ID={new_order_id}")
            
            # Update database with the new order ID and tentative price
            update_trade_order_id(username, profile_name, ticker, strike_str, current_order_id, new_order_id, fill_price=abs(target_price))
            current_order_id = new_order_id
        except Exception as e:
            print(f"[Price-Walking] Failed to submit order at step {i+1}: {e}")
            break
            
        # Wait 5 seconds
        time.sleep(5)
        
        # Check status
        try:
            order_info = trading_client.get_order_by_id(current_order_id)
            status_str = str(order_info.status.value).lower() if hasattr(order_info.status, 'value') else str(order_info.status).lower()
            
            if status_str == "filled":
                print(f"[Price-Walking] Order {current_order_id} filled successfully at step {i+1}!")
                return
            elif status_str in ["rejected", "cancelled", "expired"]:
                print(f"[Price-Walking] Order {current_order_id} was {status_str} at step {i+1}. Stopping chase.")
                # Remove from db since it was cancelled/rejected
                remove_trade_by_order_id(username, profile_name, current_order_id)
                return
        except Exception as e:
            print(f"[Price-Walking] Error checking status: {e}")
            
        # If this is the last step, we do not cancel it; leave it working in the market
        if i == len(steps) - 1:
            print(f"[Price-Walking] Reached final step. Leaving order {current_order_id} active.")
            break
            
        # Cancel the current order before placing the next step
        try:
            trading_client.cancel_order_by_id(current_order_id)
            print(f"[Price-Walking] Cancelled order {current_order_id} to prepare next step.")
            time.sleep(0.5) # small buffer to allow cancellation to register
        except Exception as e:
            print(f"[Price-Walking] Error cancelling order: {e}")
            # If cancel fails (e.g. already filled), stop chasing
            break

# Trade Order routing via Alpaca Trading API Client
@app.post("/api/trade")
def execute_trade(trade: TradeModel, username: str, background_tasks: BackgroundTasks):
    if username.lower().strip() == "gang":
        raise HTTPException(status_code=403, detail="The public 'gang' account is read-only.")
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(trade.profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Active profile configuration not found")

    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        raise HTTPException(
            status_code=400, 
            detail="Alpaca credentials are empty. Open the Setup & Themes panel and fill in your Key ID & Secret."
        )

    expiry_yymmdd = format_date_to_yymmdd(trade.expiry)
    order_legs = []
    legs_matched = re.findall(r'(Sell|Buy)\s+(\d+(?:\.\d+)?)\s*([CP])', trade.strike, re.IGNORECASE)
    
    if legs_matched:
        for action, strike_str, type_char in legs_matched:
            order_legs.append({
                "side": OrderSide.SELL if action.lower() == "sell" else OrderSide.BUY,
                "strike": float(strike_str),
                "type": "CALL" if type_char.upper() == "C" else "PUT"
            })
    else:
        try:
            strike_clean = trade.strike.replace('$', '').strip()
            strike_val = float(re.search(r'(\d+(?:\.\d+)?)', strike_clean).group(1))
            order_legs.append({
                "side": OrderSide.BUY, 
                "strike": strike_val,
                "type": "CALL" if "call" in trade.type.lower() else "PUT"
            })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not parse strike structure: {str(e)}")

    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        
        try:
            parsed_price = float(trade.price.replace('$', '').replace('+', '').strip())
            is_credit_trade = "+" in trade.price or "credit" in trade.type.lower() or "condor" in trade.type.lower()
            if is_credit_trade:
                price_val = -abs(parsed_price)
            else:
                price_val = abs(parsed_price)
        except Exception:
            price_val = -1.00 if ("credit" in trade.type.lower() or "condor" in trade.type.lower()) else 1.00 
            
        if len(order_legs) > 1:
            mleg_legs = []
            for leg in order_legs:
                osi_symbol = format_osi_symbol(trade.ticker, expiry_yymmdd, leg["type"], leg["strike"])
                intent = PositionIntent.BUY_TO_OPEN if leg["side"] == OrderSide.BUY else PositionIntent.SELL_TO_OPEN
                mleg_legs.append(
                    OptionLegRequest(
                        symbol=osi_symbol,
                        side=leg["side"],
                        ratio_qty=1,
                        position_intent=intent
                    )
                )
            
            mid_price = abs(price_val)
            spread_offset = max(0.02, round(mid_price * 0.08, 2))
            
            # Walk price steps (4 steps, 5s wait)
            # Debits: start low, walk up. Credits: start high, walk down.
            if is_credit_trade:
                steps = [
                    round(-(mid_price + spread_offset), 2),
                    round(-(mid_price + spread_offset / 2), 2),
                    round(-mid_price, 2),
                    round(-max(0.01, mid_price - spread_offset / 2), 2)
                ]
            else:
                steps = [
                    round(max(0.01, mid_price - spread_offset), 2),
                    round(max(0.01, mid_price - spread_offset / 2), 2),
                    round(mid_price, 2),
                    round(mid_price + spread_offset / 2, 2)
                ]
            
            order_request = LimitOrderRequest(
                qty=trade.qty,
                limit_price=steps[0],
                order_class=OrderClass.MLEG,
                time_in_force=TimeInForce.DAY,
                legs=mleg_legs
            )
            
            username_lower = username.lower()
            if "active_trades" not in profile_data:
                profile_data["active_trades"] = []
            
            registered_legs = []
            for leg in order_legs:
                osi_symbol = format_osi_symbol(trade.ticker, expiry_yymmdd, leg["type"], leg["strike"])
                registered_legs.append({
                    "symbol": osi_symbol,
                    "side": "buy" if leg["side"] == OrderSide.BUY else "sell",
                    "strike": leg["strike"],
                    "type": leg["type"]
                })
                
            profile_data["active_trades"].append({
                "ticker": trade.ticker.upper(),
                "strategy": trade.type,
                "strike_str": trade.strike,
                "entry_price": abs(steps[0]),
                "qty": trade.qty,
                "expiry": trade.expiry,
                "legs": registered_legs,
                "order_id": "working"
            })
            db["users"][username_lower]["state"] = user_state
            write_db(db)

            # Spawn background price-walking order chase
            background_tasks.add_task(
                work_order_chase,
                username=username,
                profile_name=trade.profile,
                ticker=trade.ticker,
                strike_str=trade.strike,
                steps=steps,
                qty=trade.qty,
                api_key=api_key,
                secret_key=secret_key,
                is_live=is_live,
                order_request=order_request
            )

            return {
                "status": "working",
                "order_id": "working",
                "legs_count": len(mleg_legs),
                "message": f"Price-walking optimizer initiated. Walking limit price over 4 steps starting at {abs(steps[0]):.2f}.",
                "is_sandbox": not is_live
            }
        else:
            leg = order_legs[0] if len(order_legs) > 0 else {"side": OrderSide.BUY, "strike": 100.0, "type": "CALL"}
            osi_symbol = format_osi_symbol(trade.ticker, expiry_yymmdd, leg["type"], leg["strike"])
            order_request = MarketOrderRequest(
                symbol=osi_symbol,
                qty=trade.qty,
                side=leg["side"],
                time_in_force=TimeInForce.DAY
            )
            order = trading_client.submit_order(order_request)
            
            username_lower = username.lower()
            if "active_trades" not in profile_data:
                profile_data["active_trades"] = []
            
            profile_data["active_trades"].append({
                "ticker": trade.ticker.upper(),
                "strategy": trade.type,
                "strike_str": trade.strike,
                "entry_price": price_val,
                "qty": trade.qty,
                "expiry": trade.expiry,
                "legs": [{
                    "symbol": osi_symbol,
                    "side": "buy" if leg["side"] == OrderSide.BUY else "sell",
                    "strike": leg["strike"],
                    "type": leg["type"]
                }],
                "order_id": str(order.id)  # FIXED: Explicitly string-cast UUID to avoid JSON errors
            })
            db["users"][username_lower]["state"] = user_state
            write_db(db)

            return {
                "status": "filled",
                "order_id": str(order.id),
                "legs_count": 1,
                "message": f"Successfully placed options order to Alpaca API.",
                "is_sandbox": not is_live
            }
        
    except Exception as err:
        raise HTTPException(
            status_code=400, 
            detail=f"Alpaca API connection failed: {str(err)}"
        )

# Model for closing positions
class ClosePositionModel(BaseModel):
    username: str
    profile: str
    ticker: str
    type: str
    strike: str
    qty: int
    expiry_yymmdd: str

@app.post("/api/positions/close")
def close_position(trade: ClosePositionModel, background_tasks: BackgroundTasks):
    if trade.username.lower().strip() == "gang":
        raise HTTPException(status_code=403, detail="The public 'gang' account is read-only.")
    db = read_db()
    user_state = db.get("users", {}).get(trade.username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(trade.profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Active profile configuration not found")
 
    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))
 
    if not api_key or not secret_key:
        raise HTTPException(
            status_code=400, 
            detail="Alpaca credentials are empty."
        )
 
    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        
        # Parse legs from strike string
        order_legs = []
        legs_matched = re.findall(r'(Sell|Buy)\s+(\d+(?:\.\d+)?)\s*([CP])', trade.strike, re.IGNORECASE)
        
        if legs_matched:
            # Multi-leg option
            for action, strike_str, type_char in legs_matched:
                order_legs.append({
                    "original_side": OrderSide.SELL if action.lower() == "sell" else OrderSide.BUY,
                    "closing_side": OrderSide.BUY if action.lower() == "sell" else OrderSide.SELL,
                    "strike": float(strike_str),
                    "type": "CALL" if type_char.upper() == "C" else "PUT"
                })
        else:
            # Single-leg option
            try:
                strike_clean = trade.strike.replace('$', '').strip()
                strike_val = float(re.search(r'(\d+(?:\.\d+)?)', strike_clean).group(1))
                opt_type = "CALL" if "call" in trade.type.lower() else "PUT"
                osi_symbol = format_osi_symbol(trade.ticker, trade.expiry_yymmdd, opt_type, strike_val)
                
                # Check current position side
                alpaca_positions = trading_client.get_all_positions()
                pos_qty = 0
                for pos in alpaca_positions:
                    if pos.symbol == osi_symbol:
                        pos_qty = float(pos.qty)
                        break
                
                if pos_qty == 0:
                    raise HTTPException(status_code=400, detail=f"No active position found for contract {osi_symbol}")
                
                closing_side = OrderSide.SELL if pos_qty > 0 else OrderSide.BUY
                qty_to_close = abs(int(pos_qty))
                
                # For single-leg options, submit market order
                order_request = MarketOrderRequest(
                    symbol=osi_symbol,
                    qty=qty_to_close,
                    side=closing_side,
                    time_in_force=TimeInForce.DAY
                )
                order = trading_client.submit_order(order_request)
                
                # Remove from db registry active_trades
                if "active_trades" in profile_data:
                    profile_data["active_trades"] = [
                        t for t in profile_data["active_trades"]
                        if not (t["ticker"] == trade.ticker.upper() and any(l["symbol"] == osi_symbol for l in t.get("legs", [])))
                    ]
                    db["users"][trade.username.lower()]["state"] = user_state
                    write_db(db)
 
                return {
                    "status": "closed",
                    "order_id": str(order.id),
                    "message": "Successfully submitted single-leg market order to close position."
                }
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not close single-leg option: {str(e)}")
 
        # For multi-leg spreads, calculate limit price from current positions
        alpaca_positions = trading_client.get_all_positions()
        pos_map = {pos.symbol: pos for pos in alpaca_positions}
        
        net_value = 0.0
        closing_legs = []
        for leg in order_legs:
            osi_symbol = format_osi_symbol(trade.ticker, trade.expiry_yymmdd, leg["type"], leg["strike"])
            intent = PositionIntent.BUY_TO_CLOSE if leg["closing_side"] == OrderSide.BUY else PositionIntent.SELL_TO_CLOSE
            closing_legs.append(
                OptionLegRequest(
                    symbol=osi_symbol,
                    side=leg["closing_side"],
                    ratio_qty=1,
                    position_intent=intent
                )
            )
            if osi_symbol in pos_map:
                mark = float(pos_map[osi_symbol].current_price)
                if leg["original_side"] == OrderSide.BUY:
                    net_value += mark
                else:
                    net_value -= mark
 
        # Check if spread is credit or debit to determine favorable buffer
        # is_credit indicates if the entry was credit.
        is_credit = "credit" in trade.type.lower() or "condor" in trade.type.lower()
        mid_price = abs(net_value)
        # Tighten spread offset to 3% instead of 8% to stay closer to mid-price and prevent sandbox order cancellations
        spread_offset = max(0.01, round(mid_price * 0.03, 2))
        
        if is_credit:
            # We had sold for credit (short position). To close, we BUY BACK (debit).
            # Start slightly below mid (cheap debit value) and walk the limit price UP (higher debit limit) to ensure fill.
            steps = [
                round(max(0.01, mid_price - spread_offset), 2),
                round(mid_price, 2),
                round(mid_price + spread_offset, 2),
                round(mid_price + spread_offset * 1.5, 2)
            ]
        else:
            # We had bought for debit (long position). To close, we SELL (credit).
            # Start slightly above mid (high credit limit, negative limit_price in Alpaca MLEG) 
            # and walk the limit price DOWN (cheaper credit limit) to ensure fill.
            steps = [
                round(-(mid_price + spread_offset), 2),
                round(-mid_price, 2),
                round(-max(0.01, mid_price - spread_offset), 2),
                round(-max(0.01, mid_price - spread_offset * 1.5), 2)
            ]
 
        order_request = LimitOrderRequest(
            qty=trade.qty,
            limit_price=steps[0],
            order_class=OrderClass.MLEG,
            time_in_force=TimeInForce.DAY,
            legs=closing_legs
        )
        
        # Put into database registry as "working"
        username_lower = trade.username.lower()
        if "active_trades" not in profile_data:
            profile_data["active_trades"] = []
            
        profile_data["active_trades"].append({
            "ticker": trade.ticker.upper(),
            "strategy": trade.type,
            "strike_str": trade.strike,
            "entry_price": mid_price,
            "qty": trade.qty,
            "expiry": trade.expiry_yymmdd,
            "legs": [{"symbol": format_osi_symbol(trade.ticker, trade.expiry_yymmdd, leg["type"], leg["strike"])} for leg in order_legs],
            "order_id": "working"
        })
        db["users"][username_lower]["state"] = user_state
        write_db(db)
        
        # Dispatch background price-walking order chase
        background_tasks.add_task(
            work_order_chase,
            username=trade.username,
            profile_name=trade.profile,
            ticker=trade.ticker,
            strike_str=trade.strike,
            steps=steps,
            qty=trade.qty,
            api_key=api_key,
            secret_key=secret_key,
            is_live=is_live,
            order_request=order_request
        )
 
        return {
            "status": "working",
            "order_id": "working",
            "message": f"Successfully initiated closing price-walking optimizer. Walking limit price over 4 steps starting at {abs(steps[0]):.2f}."
        }
 
    except Exception as err:
        raise HTTPException(
            status_code=400, 
            detail=f"Alpaca API close execution failed: {str(err)}"
        )

class UpdateProfitTargetModel(BaseModel):
    username: str
    profile: str
    ticker: str
    type: str
    strike: str
    qty: int
    expiry_yymmdd: str
    tp_price: float

class CancelOrderModel(BaseModel):
    username: str
    profile: str
    order_id: str

@app.post("/api/positions/update_tp")
def update_profit_target(trade: UpdateProfitTargetModel):
    if trade.username.lower().strip() == "gang":
        raise HTTPException(status_code=403, detail="The public 'gang' account is read-only.")
    db = read_db()
    user_state = db.get("users", {}).get(trade.username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(trade.profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Active profile configuration not found")

    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        raise HTTPException(status_code=400, detail="Alpaca credentials are empty.")

    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        
        # Parse legs from strike string
        order_legs = []
        legs_matched = re.findall(r'(Sell|Buy)\s+(\d+(?:\.\d+)?)\s*([CP])', trade.strike, re.IGNORECASE)
        
        if legs_matched:
            # Multi-leg option
            for action, strike_str, type_char in legs_matched:
                order_legs.append({
                    "original_side": OrderSide.SELL if action.lower() == "sell" else OrderSide.BUY,
                    "closing_side": OrderSide.BUY if action.lower() == "sell" else OrderSide.SELL,
                    "strike": float(strike_str),
                    "type": "CALL" if type_char.upper() == "C" else "PUT"
                })
        else:
            # Single-leg option
            try:
                strike_clean = trade.strike.replace('$', '').strip()
                strike_val = float(re.search(r'(\d+(?:\.\d+)?)', strike_clean).group(1))
                opt_type = "CALL" if "call" in trade.type.lower() else "PUT"
                order_legs.append({
                    "original_side": OrderSide.BUY, # default fallback
                    "closing_side": OrderSide.SELL,
                    "strike": strike_val,
                    "type": opt_type
                })
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not parse strike: {str(e)}")

        closing_legs = []
        for leg in order_legs:
            osi_symbol = format_osi_symbol(trade.ticker, trade.expiry_yymmdd, leg["type"], leg["strike"])
            intent = PositionIntent.BUY_TO_CLOSE if leg["closing_side"] == OrderSide.BUY else PositionIntent.SELL_TO_CLOSE
            closing_legs.append(
                OptionLegRequest(
                    symbol=osi_symbol,
                    side=leg["closing_side"],
                    ratio_qty=1,
                    position_intent=intent
                )
            )

        # Check if spread is credit or debit to determine correct sign of limit price
        # Credits are closed by paying a debit (positive value). Debits are closed by collecting credit (negative limit value in Alpaca)
        is_credit = "credit" in trade.type.lower() or "condor" in trade.type.lower()
        limit_price = round(abs(trade.tp_price), 2) if is_credit else -round(abs(trade.tp_price), 2)

        if len(closing_legs) > 1:
            order_request = LimitOrderRequest(
                qty=trade.qty,
                limit_price=limit_price,
                order_class=OrderClass.MLEG,
                time_in_force=TimeInForce.GTC,
                legs=closing_legs
            )
        else:
            order_request = LimitOrderRequest(
                symbol=closing_legs[0].symbol,
                qty=trade.qty,
                side=closing_legs[0].side,
                time_in_force=TimeInForce.GTC,
                limit_price=abs(limit_price)
            )

        order = trading_client.submit_order(order_request)

        # Update local active trades registry with custom profit target and order ID
        username_lower = trade.username.lower()
        if "active_trades" in profile_data:
            symbols_to_close = {format_osi_symbol(trade.ticker, trade.expiry_yymmdd, leg["type"], leg["strike"]) for leg in order_legs}
            for t in profile_data["active_trades"]:
                if t["ticker"] == trade.ticker.upper() and any(l["symbol"] in symbols_to_close for l in t.get("legs", [])):
                    t["profit_target"] = abs(trade.tp_price)
                    t["order_id"] = str(order.id)
                    break
            db["users"][username_lower]["state"] = user_state
            write_db(db)

        return {
            "status": "success",
            "order_id": str(order.id),
            "message": f"Successfully placed GTC Take Profit Limit Order at ${abs(limit_price):.2f}"
        }

    except Exception as err:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to submit profit target order: {str(err)}"
        )

@app.get("/api/positions/orders")
def get_open_orders(username: str, profile: str):
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(profile)
    
    if not profile_data:
        return []

    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        return []

    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        # Using native REST requests to fetch open orders
        base_url = "https://api.alpaca.markets" if is_live else "https://paper-api.alpaca.markets"
        headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret_key
        }
        # Fetch status=open limit orders
        res = requests.get(f"{base_url}/v2/orders?status=open&nested=true", headers=headers, timeout=5)
        if res.status_code == 200:
            orders_list = res.json()
            formatted_orders = []
            for o in orders_list:
                formatted_orders.append({
                    "id": o["id"],
                    "client_order_id": o["client_order_id"],
                    "symbol": o.get("symbol", ""),
                    "qty": o.get("qty", "1"),
                    "limit_price": o.get("limit_price"),
                    "legs": [{
                        "symbol": leg.get("symbol"),
                        "side": leg.get("side"),
                        "qty": leg.get("qty")
                    } for leg in o.get("legs", [])]
                })
            return formatted_orders
        return []
    except Exception:
        return []

@app.post("/api/positions/cancel_order")
def cancel_open_order(trade: CancelOrderModel):
    if trade.username.lower().strip() == "gang":
        raise HTTPException(status_code=403, detail="The public 'gang' account is read-only.")
    db = read_db()
    user_state = db.get("users", {}).get(trade.username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(trade.profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Active profile configuration not found")

    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        raise HTTPException(status_code=400, detail="Alpaca credentials are empty.")

    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        trading_client.cancel_order_by_id(trade.order_id)
        
        # Clear the order reference in database active_trades
        username_lower = trade.username.lower()
        if "active_trades" in profile_data:
            for t in profile_data["active_trades"]:
                if t.get("order_id") == trade.order_id:
                    t["order_id"] = "working" # reset status
                    break
            db["users"][username_lower]["state"] = user_state
            write_db(db)

        return {"status": "cancelled", "message": "Successfully cancelled limit order."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to cancel order: {str(e)}")

# Hull Moving Average and indicator math helpers
def calculate_wma(data: list, period: int) -> list:
    wma_list = []
    for i in range(len(data)):
        if i < period - 1:
            wma_list.append(None)
            continue
        weight_sum = sum(range(1, period + 1))
        val_sum = sum(data[i - period + 1 + j] * (j + 1) for j in range(period))
        wma_list.append(round(val_sum / weight_sum, 2))
    return wma_list

def calculate_hma(data: list, period: int) -> list:
    half_period = int(period / 2)
    wma_half = calculate_wma(data, half_period)
    wma_full = calculate_wma(data, period)
    
    diff = []
    for wh, wf in zip(wma_half, wma_full):
        if wh is None or wf is None:
            diff.append(None)
        else:
            diff.append(2.0 * wh - wf)
            
    sqrt_period = int(math.sqrt(period))
    non_none_start = next((i for i, x in enumerate(diff) if x is not None), len(diff))
    diff_clean = diff[non_none_start:]
    
    wma_diff = calculate_wma(diff_clean, sqrt_period)
    
    res = [None] * non_none_start
    res.extend(wma_diff)
    return res

def calculate_supertrend(highs: list, lows: list, closes: list, period: int = 12, multiplier: float = 2.2) -> tuple:
    n = len(closes)
    atr = [0.0] * n
    tr = [0.0] * n
    for i in range(1, n):
        tr[i] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i-1]),
            abs(lows[i] - closes[i-1])
        )
    tr[0] = highs[0] - lows[0]
    
    for i in range(period - 1, n):
        if i == period - 1:
            atr[i] = sum(tr[:period]) / period
        else:
            atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period

    supertrend = [None] * n
    direction = [1] * n
    final_upper = [0.0] * n
    final_lower = [0.0] * n
    
    for i in range(period, n):
        hl2 = (highs[i] + lows[i]) / 2.0
        basic_upper = hl2 + multiplier * atr[i]
        basic_lower = hl2 - multiplier * atr[i]
        
        if basic_upper < final_upper[i-1] or closes[i-1] > final_upper[i-1]:
            final_upper[i] = basic_upper
        else:
            final_upper[i] = final_upper[i-1]
            
        if basic_lower > final_lower[i-1] or closes[i-1] < final_lower[i-1]:
            final_lower[i] = basic_lower
        else:
            final_lower[i] = final_lower[i-1]
            
        if closes[i] > final_upper[i]:
            direction[i] = 1
        elif closes[i] < final_lower[i]:
            direction[i] = -1
        else:
            direction[i] = direction[i-1]
            
        st_val = final_lower[i] if direction[i] == 1 else final_upper[i]
        supertrend[i] = round(st_val, 2)
          
    return supertrend, direction

def calculate_stochastic_d(highs: list, lows: list, closes: list, k_period: int, d_period: int) -> list:
    n = len(closes)
    k_values = [0.0] * n
    for i in range(k_period - 1, n):
        low_low = min(lows[i - k_period + 1 : i + 1])
        high_high = max(highs[i - k_period + 1 : i + 1])
        diff = high_high - low_low
        if diff == 0:
            k_values[i] = 50.0
        else:
            k_values[i] = (closes[i] - low_low) / diff * 100.0
            
    d_values = [None] * n
    for i in range(k_period + d_period - 2, n):
        d_values[i] = round(sum(k_values[i - d_period + 1 : i + 1]) / d_period, 2)
    return d_values

# Fetch 1h Candlestick Chart Data & Technical Indicators
@app.get("/api/chart/technical")
def get_chart_technical(ticker: str):
    ticker_upper = ticker.strip().upper()
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker_upper}?interval=1h&range=1mo"
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch data from Yahoo Finance.")
            
        data = res.json()
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        quotes = result["indicators"]["quote"][0]
        
        opens = quotes["open"]
        highs = quotes["high"]
        lows = quotes["low"]
        closes = quotes["close"]
        
        clean_timestamps = []
        clean_opens = []
        clean_highs = []
        clean_lows = []
        clean_closes = []
        
        for i in range(len(closes)):
            if (closes[i] is not None and highs[i] is not None and 
                lows[i] is not None and opens[i] is not None and timestamps[i] is not None):
                clean_timestamps.append(timestamps[i])
                clean_opens.append(round(opens[i], 2))
                clean_highs.append(round(highs[i], 2))
                clean_lows.append(round(lows[i], 2))
                clean_closes.append(round(closes[i], 2))
                
        if len(clean_closes) < 45:
            raise HTTPException(status_code=400, detail="Not enough bar history to compute indicators.")
            
        hma30 = calculate_hma(clean_closes, 30)
        supertrend, direction = calculate_supertrend(clean_highs, clean_lows, clean_closes, 12, 2.2)
        stoch14_4d = calculate_stochastic_d(clean_highs, clean_lows, clean_closes, 14, 4)
        stoch40_4d = calculate_stochastic_d(clean_highs, clean_lows, clean_closes, 40, 4)
        
        return {
            "ticker": ticker_upper,
            "timestamps": clean_timestamps,
            "opens": clean_opens,
            "highs": clean_highs,
            "lows": clean_lows,
            "closes": clean_closes,
            "hma30": hma30,
            "supertrend": supertrend,
            "supertrendDirection": direction,
            "stoch14_4d": stoch14_4d,
            "stoch40_4d": stoch40_4d
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error generating technical indicators: {str(e)}")

# Timezone-aware core trading hours check helper
def is_market_hours_for_autoclose() -> bool:
    import datetime
    try:
        from zoneinfo import ZoneInfo
        tz_est = ZoneInfo("America/New_York")
        now_est = datetime.datetime.now(tz_est)
    except Exception:
        # Fallback assuming UTC timezone subtraction for EDT (UTC-4)
        now_est = datetime.datetime.utcnow() - datetime.timedelta(hours=4)
        
    # Weekday check
    if now_est.weekday() >= 5:
        return False
        
    # Allow execution between 9:50 AM and 3:50 PM EST
    current_time = now_est.time()
    start_time = datetime.time(9, 50)
    end_time = datetime.time(15, 50)
    
    return start_time <= current_time <= end_time

# Background daemon to monitor open options positions and auto-close on threshold breach
def monitor_positions_loop():
    print("AuraTrade Options Position Monitor Daemon is currently paused.")
    return
    print("Starting AuraTrade Options Position Monitor Daemon...")
    while True:
        try:
            # Skip checking/closing entirely if not within restricted core trading hours
            if not is_market_hours_for_autoclose():
                time.sleep(60)
                continue

            db = read_db()
            users = db.get("users", {})
            db_changed = False
            
            for username, user_data in users.items():
                state = user_data.get("state", {})
                profiles = state.get("profiles", {})
                
                for profile_name, profile_data in profiles.items():
                    active_trades = profile_data.get("active_trades", [])
                    if not active_trades:
                        continue
                    
                    api_key = profile_data.get("alpacaApiKey") or os.environ.get("ALPACA_API_KEY")
                    secret_key = profile_data.get("alpacaSecretKey") or os.environ.get("ALPACA_SECRET_KEY")
                    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))
                    
                    if not api_key or not secret_key:
                        continue
                    
                    try:
                        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
                        alpaca_positions = trading_client.get_all_positions()
                    except Exception as err:
                        print(f"[{username}/{profile_name}] Alpaca connection failed in monitor: {err}")
                        continue
                    
                    pos_map = {pos.symbol: pos for pos in alpaca_positions}
                    trades_to_keep = []
                    profile_changed = False
                    
                    for trade in active_trades:
                        order_id = trade.get("order_id")
                        if order_id:
                            try:
                                order_info = trading_client.get_order_by_id(order_id)
                                status_str = str(order_info.status.value).lower() if hasattr(order_info.status, 'value') else str(order_info.status).lower()
                                
                                # Keep in registry and skip evaluating if order is still pending
                                if status_str in ["new", "accepted", "pending_new", "accepted_for_bidding", "partially_filled"]:
                                    trades_to_keep.append(trade)
                                    continue
                                # Cancelled/rejected/expired orders are cleared
                                elif status_str in ["rejected", "expired", "cancelled"]:
                                    profile_changed = True
                                    db_changed = True
                                    continue
                            except Exception as order_err:
                                print(f"[{username}/{profile_name}] Order status lookup failed for {order_id}, falling back to positions: {order_err}")
                                pass

                        legs = trade.get("legs", [])
                        legs_present = []
                        missing_leg = False
                        
                        for leg in legs:
                            symbol = leg["symbol"]
                            if symbol in pos_map:
                                legs_present.append(pos_map[symbol])
                            else:
                                missing_leg = True
                                break
                        
                        if missing_leg:
                            print(f"[{username}/{profile_name}] Trade strategy {trade['strategy']} for {trade['ticker']} is missing legs. Clearing from registry.")
                            profile_changed = True
                            db_changed = True
                            continue
                        
                        net_value = 0.0
                        for leg in legs:
                            symbol = leg["symbol"]
                            pos = pos_map[symbol]
                            mark = float(pos.current_price)
                            side = leg["side"]
                            if side == "buy": 
                                net_value += mark
                            else: 
                                net_value -= mark
                        
                        entry_price = float(trade["entry_price"])
                        strategy_type = trade["strategy"].lower()
                        
                        is_credit = "credit" in strategy_type or "condor" in strategy_type
                        is_debit = "debit" in strategy_type or "straddle" in strategy_type
                        
                        trigger_close = False
                        reason = ""
                        
                        if is_credit:
                            current_cost = -net_value
                            profit_target = entry_price * 0.50
                            stop_loss = entry_price * 2.00
                            
                            if current_cost <= profit_target:
                                trigger_close = True
                                reason = f"Take Profit (+50% credit): cost is ${current_cost:.2f} <= target ${profit_target:.2f}"
                            elif current_cost >= stop_loss:
                                trigger_close = True
                                reason = f"Stop Loss (-100% loss): cost is ${current_cost:.2f} >= stop ${stop_loss:.2f}"
                                
                        elif is_debit:
                            current_value = net_value
                            profit_target = entry_price * 1.50
                            stop_loss = entry_price * 0.50
                            
                            if current_value >= profit_target:
                                trigger_close = True
                                reason = f"Take Profit (+50% ROI): value is ${current_value:.2f} >= target ${profit_target:.2f}"
                            elif current_value <= stop_loss:
                                trigger_close = True
                                reason = f"Stop Loss (-50% loss): value is ${current_value:.2f} <= stop ${stop_loss:.2f}"
                        
                        if trigger_close:
                            print(f"[{username}/{profile_name}] Triggered Auto-Close on {trade['ticker']} {trade['strategy']} due to: {reason}!")
                            try:
                                closing_legs = []
                                expiry_yymmdd = format_date_to_yymmdd(trade["expiry"])
                                for leg in legs:
                                    reverse_side = OrderSide.SELL if leg["side"] == "buy" else OrderSide.BUY
                                    osi_symbol = format_osi_symbol(trade["ticker"], expiry_yymmdd, leg["type"], float(leg["strike"]))
                                    closing_legs.append(
                                        OptionLegRequest(
                                            symbol=osi_symbol,
                                            side=reverse_side,
                                            ratio_qty=1
                                        )
                                    )
                                
                                # Use execution price buffer (+/- $0.10) to ensure immediate fill
                                if is_credit:
                                    close_price_limit = round(current_cost + 0.10, 2)
                                else:
                                    close_price_limit = max(0.05, round(current_value - 0.10, 2))
                                    
                                if len(closing_legs) > 1:
                                    order_request = LimitOrderRequest(
                                        qty=trade["qty"],
                                        limit_price=close_price_limit,
                                        order_class=OrderClass.MLEG,
                                        time_in_force=TimeInForce.DAY,
                                        legs=closing_legs
                                    )
                                else:
                                    order_request = LimitOrderRequest(
                                        symbol=closing_legs[0].symbol,
                                        qty=trade["qty"],
                                        side=closing_legs[0].side,
                                        time_in_force=TimeInForce.DAY,
                                        limit_price=close_price_limit
                                    )
                                    
                                closing_order = trading_client.submit_order(order_request)
                                print(f"[{username}/{profile_name}] Successfully submitted closing order {str(closing_order.id)} for {trade['ticker']}.")
                                profile_changed = True
                                db_changed = True
                            except Exception as close_err:
                                print(f"[{username}/{profile_name}] Failed to place close order: {close_err}")
                                trades_to_keep.append(trade)
                        else:
                            trades_to_keep.append(trade)
                            
                    if profile_changed:
                        profile_data["active_trades"] = trades_to_keep
                        
            if db_changed:
                write_db(db)
                
        except Exception as loop_err:
            print(f"Error in position monitor loop: {loop_err}")
            
        time.sleep(60)

@app.on_event("startup")
def startup_event():
    t = threading.Thread(target=monitor_positions_loop, daemon=True)
    t.start()

# Serve Frontend static assets
@app.get("/")
def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

# Mount remaining files (CSS, JS, assets)
app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
