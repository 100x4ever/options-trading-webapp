with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\backend\main.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "@app.get(\"/api/positions\")" in line or "def get_alpaca_positions" in line:
        print(f"Line {i}: {line.strip()}")
        # print surrounding lines from line 304 to 380
        for j in range(304, 380):
            if j < len(lines):
                print(f"  [{j+1}]: {lines[j].strip()}")
        break
