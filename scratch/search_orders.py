filepath = r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\backend\main.py"
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "api/trade" in line or "trade_spread" in line or "OrderRequest" in line or "Order" in line:
        if "def " in line or "@app" in line or "order" in line.lower() or "client" in line.lower():
            print(f"Line {i}: {line.strip()}")
