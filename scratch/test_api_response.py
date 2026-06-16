import requests

# Test local server response
try:
    login_url = "https://options-trading-webapp-production.up.railway.app/api/auth/login"
    login_data = {"username": "agent", "password": "test"}
    r = requests.post(login_url, json=login_data)
    print("Login Status:", r.status_code)
    
    positions_url = "https://options-trading-webapp-production.up.railway.app/api/positions?username=agent&profile=Default%20User"
    r2 = requests.get(positions_url)
    print("Positions Status:", r2.status_code)
    print("Positions JSON:")
    import json
    print(json.dumps(r2.json(), indent=2))
except Exception as e:
    print("Error:", e)
