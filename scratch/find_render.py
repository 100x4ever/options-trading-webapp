import re

with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\app.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "function render" in line or "const render" in line or "renderPositions" in line or "renderDashboard" in line:
        print(f"{idx+1}: {line.strip()}")
