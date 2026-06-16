with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\backend\main.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

for j in range(380, 500):
    if j < len(lines):
        print(f"  [{j+1}]: {lines[j].strip()}")
