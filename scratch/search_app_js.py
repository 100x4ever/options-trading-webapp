with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\app.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "/api/trade" in line:
        print(f"Line {i}: {line.strip()}")
        # Print surrounding lines
        for j in range(max(0, i-20), min(len(lines), i+30)):
            print(f"  [{j+1}]: {lines[j].strip()}")
