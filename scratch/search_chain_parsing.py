import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\app.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "/api/options/chain" in line:
        print(f"Line {i}: {line.strip()}")
        # print surrounding lines from line 800 to 1050
        for j in range(800, 1050):
            if j < len(lines):
                print(f"  [{j+1}]: {lines[j].strip()}")
        break
