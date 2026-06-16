with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\index.html", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "positionsTable" in line or "Positions" in line or "<thead>" in line or "tbody" in line:
        if "positions" in line.lower() or "table" in line.lower() or "thead" in line.lower():
            print(f"{idx+1}: {line.strip()}")
