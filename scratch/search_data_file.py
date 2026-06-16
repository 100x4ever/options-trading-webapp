with open(r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\backend\main.py", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines, 1):
    if "DATA_FILE" in line:
        print(f"Line {i}: {line.strip()}")
