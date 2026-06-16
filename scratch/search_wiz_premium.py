with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\app.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "wizCurrentTrade" in line or ".premium =" in line or "premium:" in line:
        if i > 1200: # We know it's in calculateWizardStrategy
            print(f"Line {i}: {line.strip()}")
            start = max(0, i-10)
            end = min(len(lines), i+15)
            for j in range(start, end):
                print(f"  [{j+1}]: {lines[j].strip()}")
