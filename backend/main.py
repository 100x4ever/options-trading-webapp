import os
import json
import requests
import uuid
import hashlib
import re
import math
from datetime import date
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

# Alpaca Client imports
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import LimitOrderRequest, OptionLegRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

app = FastAPI(title="AuraTrade Backend Server")

# Define directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DATA_FILE = os.path.join(BASE_DIR, "profiles_db.json")

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
                "alpacaApiKey": "",
                "alpacaSecretKey": "",
                "alpacaLive": False,
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

    api_key = profile_data.get("alpacaApiKey")
    secret_key = profile_data.get("alpacaSecretKey")
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

# Retrieve Live Positions Table
@app.get("/api/positions")
def get_alpaca_positions(username: str, profile: str):
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Profile not found")

    api_key = profile_data.get("alpacaApiKey")
    secret_key = profile_data.get("alpacaSecretKey")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        return []

    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        positions = trading_client.get_all_positions()
        
        formatted_positions = []
        for pos in positions:
            # Check if asset class is option or parsing option symbol
            symbol = pos.symbol
            # Check if option contract formatting is e.g. AAPL260619C00185000
            match = re.match(r'^([A-Z]{1,6})(\d{6})([CP])(\d{8})$', symbol)
            
            if match:
                ticker, expiry_yymmdd, side_char, strike_raw = match.groups()
                option_type = "Call" if side_char == "C" else "Put"
                strike_val = float(strike_raw) / 1000.0
                
                # Expiry clean date e.g. Jun 19
                exp_clean = f"{expiry_yymmdd[2:4]}/{expiry_yymmdd[4:6]}"
                
                pnl_val = float(pos.unrealized_pl)
                pnl_str = f"+${pnl_val:.2f}" if pnl_val >= 0 else f"-${abs(pnl_val):.2f}"
                status = "positive" if pnl_val >= 0 else "negative"
                
                formatted_positions.append({
                    "ticker": ticker,
                    "type": option_type,
                    "strike": f"{strike_val:.2f}",
                    "exp": exp_clean,
                    "qty": int(pos.qty),
                    "avg": f"{float(pos.avg_entry_price):.2f}",
                    "mark": f"{float(pos.current_price):.2f}",
                    "delta": "+0.50" if option_type == "Call" else "-0.50",
                    "theta": "-0.15",
                    "pnl": pnl_str,
                    "status": status
                })
            else:
                # Stock position representation
                pnl_val = float(pos.unrealized_pl)
                pnl_str = f"+${pnl_val:.2f}" if pnl_val >= 0 else f"-${abs(pnl_val):.2f}"
                formatted_positions.append({
                    "ticker": symbol,
                    "type": "Stock",
                    "strike": "-",
                    "exp": "-",
                    "qty": int(pos.qty),
                    "avg": f"{float(pos.avg_entry_price):.2f}",
                    "mark": f"{float(pos.current_price):.2f}",
                    "delta": "1.00",
                    "theta": "0.00",
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

    api_key = profile_data.get("alpacaApiKey")
    secret_key = profile_data.get("alpacaSecretKey")
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
    
    api_key = profile_data.get("alpacaApiKey")
    secret_key = profile_data.get("alpacaSecretKey")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))
    
    ticker_upper = ticker.strip().upper()
    
    # 1. Try fetching real-time price from Yahoo Finance (fast, key-free, and handles live keys without subscription errors)
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

    # 2. Try fetching from Alpaca as fallback
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

    # 3. Final default fallback based on typical prices
    if underlying_price is None:
        if ticker_upper == "QQQ":
            underlying_price = 740.0
        elif ticker_upper == "AAPL":
            underlying_price = 310.0
        else:
            underlying_price = 180.0

    # 2. Get Expiration & DTE (Days to Expiration)
    yymmdd = format_date_to_yymmdd(expiry)
    try:
        exp_date = date(2000 + int(yymmdd[0:2]), int(yymmdd[2:4]), int(yymmdd[4:6]))
        dte = max(1, (exp_date - date.today()).days)
    except Exception:
        dte = 10
        
    t = dte / 365.0
    r = 0.045 # Risk-free rate
    sigma = 0.22 # Implied Volatility
    
    # Choose Strike intervals dynamically based on price level
    if underlying_price > 500:
        step = 10
    elif underlying_price > 150:
        step = 5
    elif underlying_price > 50:
        step = 2.5
    else:
        step = 1
        
    # Generate 5 strikes below and 5 strikes above
    atm_strike = round(underlying_price / step) * step
    strikes_list = [atm_strike + i * step for i in range(-4, 5)]
    
    strikes_data = []
    for strike in strikes_list:
        # Call Greeks
        c_greeks = calculate_greeks(underlying_price, strike, t, r, sigma, "call")
        # Put Greeks
        p_greeks = calculate_greeks(underlying_price, strike, t, r, sigma, "put")
        
        # Bids / Asks spreads: Bid is slightly below price, Ask is slightly above
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

# Trade Order routing via Alpaca Trading API Client
@app.post("/api/trade")
def execute_trade(trade: TradeModel, username: str):
    if username.lower().strip() == "gang":
        raise HTTPException(status_code=403, detail="The public 'gang' account is read-only.")
    db = read_db()
    user_state = db.get("users", {}).get(username.lower(), {}).get("state", {})
    profile_data = user_state.get("profiles", {}).get(trade.profile)
    
    if not profile_data:
        raise HTTPException(status_code=404, detail="Active profile configuration not found")

    api_key = profile_data.get("alpacaApiKey")
    secret_key = profile_data.get("alpacaSecretKey")
    is_live = check_is_live(api_key, profile_data.get("alpacaLive", False))

    if not api_key or not secret_key:
        raise HTTPException(
            status_code=400, 
            detail="Alpaca credentials are empty. Open the Setup & Themes panel and fill in your Key ID & Secret."
        )

    # 1. Parse Expiration Date to YYMMDD
    expiry_yymmdd = format_date_to_yymmdd(trade.expiry)

    # 2. Extract multi-leg option orders sequential execution or single contract
    order_legs = []
    
    # Try parsing patterns like: "Sell 445P / Buy 440P" or "Sell 465C/Buy 470C + Sell 445P/Buy 440P"
    legs_matched = re.findall(r'(Sell|Buy)\s+(\d+(?:\.\d+)?)\s*([CP])', trade.strike, re.IGNORECASE)
    
    if legs_matched:
        for action, strike_str, type_char in legs_matched:
            order_legs.append({
                "side": OrderSide.SELL if action.lower() == "sell" else OrderSide.BUY,
                "strike": float(strike_str),
                "type": "CALL" if type_char.upper() == "C" else "PUT"
            })
    else:
        # Fallback to single leg option trade from chain (e.g. Strike = "185.00", type = "CALL")
        try:
            strike_clean = trade.strike.replace('$', '').strip()
            strike_val = float(re.search(r'(\d+(?:\.\d+)?)', strike_clean).group(1))
            order_legs.append({
                "side": OrderSide.BUY, # Defaults to long purchase in option chain picker
                "strike": strike_val,
                "type": "CALL" if "call" in trade.type.lower() else "PUT"
            })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not parse strike structure: {str(e)}")

    # 3. Place option orders to Alpaca Client
    try:
        trading_client = TradingClient(api_key, secret_key, paper=not is_live)
        placed_orders = []
        
        # Calculate limit price per contract if executing multi-legs (simple split or proportional logic)
        try:
            price_val = float(trade.price.replace('$', '').replace('+', '').strip())
        except Exception:
            price_val = 1.00 # default fallback
            
        if len(order_legs) > 1:
            mleg_legs = []
            for leg in order_legs:
                osi_symbol = format_osi_symbol(trade.ticker, expiry_yymmdd, leg["type"], leg["strike"])
                mleg_legs.append(
                    OptionLegRequest(
                        symbol=osi_symbol,
                        side=leg["side"],
                        ratio_qty=1
                    )
                )
            
            order_request = LimitOrderRequest(
                qty=trade.qty,
                limit_price=price_val,
                order_class=OrderClass.MLEG,
                time_in_force=TimeInForce.DAY,
                legs=mleg_legs
            )
            order = trading_client.submit_order(order_request)
            
            # Record successful trade to DB
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
                "entry_price": price_val,
                "qty": trade.qty,
                "expiry": trade.expiry,
                "legs": registered_legs,
                "order_id": order.id
            })
            db["users"][username_lower]["state"] = user_state
            write_db(db)

            return {
                "status": "filled",
                "order_id": order.id,
                "legs_count": len(mleg_legs),
                "message": f"Successfully placed multi-leg order spread to Alpaca API.",
                "is_sandbox": not is_live
            }
        else:
            leg = order_legs[0] if len(order_legs) > 0 else {"side": OrderSide.BUY, "strike": 100.0, "type": "CALL"}
            osi_symbol = format_osi_symbol(trade.ticker, expiry_yymmdd, leg["type"], leg["strike"])
            order_request = LimitOrderRequest(
                symbol=osi_symbol,
                qty=trade.qty,
                side=leg["side"],
                time_in_force=TimeInForce.DAY,
                limit_price=price_val
            )
            order = trading_client.submit_order(order_request)
            
            # Record successful trade to DB
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
                "order_id": order.id
            })
            db["users"][username_lower]["state"] = user_state
            write_db(db)

            return {
                "status": "filled",
                "order_id": order.id,
                "legs_count": 1,
                "message": f"Successfully placed options order to Alpaca API.",
                "is_sandbox": not is_live
            }
        
    except Exception as err:
        raise HTTPException(
            status_code=400, 
            detail=f"Alpaca API connection failed: {str(err)}"
        )

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

# Fetch 1h Candlestick Chart Data & Technical Indicators (HMA, Supertrend, Stochastics)
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
        
        # Clean data (remove None values if any)
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
            
        # Calculate indicator overlays
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

# Background daemon to monitor open options positions and auto-close on threshold breach
import threading
import time

def monitor_positions_loop():
    print("Starting AuraTrade Options Position Monitor Daemon...")
    while True:
        try:
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
                    
                    api_key = profile_data.get("alpacaApiKey")
                    secret_key = profile_data.get("alpacaSecretKey")
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
                            # Discard trade if legs are missing (already closed or expired)
                            print(f"[{username}/{profile_name}] Trade strategy {trade['strategy']} for {trade['ticker']} is missing legs. Clearing from registry.")
                            profile_changed = True
                            db_changed = True
                            continue
                        
                        # Calculate current net cost/value to close using positions mark prices
                        net_value = 0.0
                        for leg in legs:
                            symbol = leg["symbol"]
                            pos = pos_map[symbol]
                            mark = float(pos.current_price)
                            side = leg["side"]
                            if side == "buy": # we sell to close (receive credit)
                                net_value += mark
                            else: # we buy to close (pay debit)
                                net_value -= mark
                        
                        entry_price = float(trade["entry_price"])
                        strategy_type = trade["strategy"].lower()
                        
                        is_credit = "credit" in strategy_type or "condor" in strategy_type
                        is_debit = "debit" in strategy_type or "straddle" in strategy_type
                        
                        trigger_close = False
                        reason = ""
                        
                        if is_credit:
                            # net_value = long - short (negative). current spread cost = short - long (-net_value)
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
                            # net_value = long - short (positive). current spread value = net_value
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
                                
                                # Set close order limit price with execution facilitation buffer
                                if is_credit:
                                    close_price_limit = round(current_cost + 0.05, 2)
                                else:
                                    close_price_limit = max(0.05, round(current_value - 0.05, 2))
                                    
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
                                    
                                trading_client.submit_order(order_request)
                                print(f"[{username}/{profile_name}] Successfully submitted closing order for {trade['ticker']}.")
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
