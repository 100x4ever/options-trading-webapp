import os

possible_paths = [
    r"C:\app\data\profiles_db.json",
    r"C:\Users\vp\.gemini\antigravity\scratch\options-trading-webapp\backend\profiles_db.json"
]

for p in possible_paths:
    if os.path.exists(p):
        print(f"Found database at: {p}")
        try:
            with open(p, "r") as f:
                data = json.load(f)
                print("Users:", list(data.get("users", {}).keys()))
        except Exception as e:
            print("Read error:", e)
