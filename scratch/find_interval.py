with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\app.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "setInterval" in line or "5000" in line:
        print(f"{idx+1}: {line.strip()}")
