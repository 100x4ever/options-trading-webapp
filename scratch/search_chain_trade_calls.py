import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\app.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "tradeSpreadFromChain" in line and not "window.tradeSpreadFromChain = " in line and not "function" in line:
        print(f"Line {i}: {line.strip()}")
        # print surrounding lines
        start = max(0, i-5)
        end = min(len(lines), i+15)
        for j in range(start, end):
            print(f"  [{j+1}]: {lines[j].strip()}")
