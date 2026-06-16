import sys
sys.stdout.reconfigure(encoding='utf-8')

with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\app.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "function calculateWizardStrategy" in line:
        print(f"Line {i}: {line.strip()}")
        # print lines 1361 to 1600
        for j in range(1361, 1600):
            if j < len(lines):
                print(f"  [{j+1}]: {lines[j].strip()}")
