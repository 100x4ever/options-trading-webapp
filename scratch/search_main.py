import re

with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\backend\main.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

keywords = ["/api/positions/close", "/api/trade", "transmit", "order", "alpaca", "spread", "credit", "debit", "side"]

for i, line in enumerate(lines, 1):
    # Check for functions/endpoints
    if "@app." in line or "def " in line:
        print(f"Line {i}: {line.strip()}")
    # Check for specific search terms of interest
    for kw in ["orders", "execute", "close", "spread", "submit_order", "legs", "buy", "sell"]:
        if kw in line.lower() and ("def " in line or "@app" in line or "api" in line or "class" in line):
            print(f"--> Line {i}: {line.strip()}")
