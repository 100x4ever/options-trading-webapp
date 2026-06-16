with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\frontend\style.css", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "@media" in line:
        print(f"{idx+1}: {line.strip()}")
