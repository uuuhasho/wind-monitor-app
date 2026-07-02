import os
import re
import json
import requests
from datetime import datetime, timezone, timedelta
from src.config import load_config, get_service_account_path

MONTHS_MAP = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12
}

def parse_forecast_dates(initial_date_str, points):
    """
    Parses initial_date_str (e.g. '12Z29MAY') and points list to construct
    ISO 8601 local CST datetime strings for each point.
    Returns a list of dicts with 'timestamp_cst' and 'wind_speed_kt'.
    """
    match = re.match(r"(\d+)Z(\d+)([A-Z]{3})", initial_date_str)
    if not match:
        raise ValueError(f"Invalid initial date format: {initial_date_str}")
        
    init_hour = int(match.group(1))
    init_day = int(match.group(2))
    init_month_str = match.group(3)
    init_month = MONTHS_MAP.get(init_month_str, 5)
    # Target year from current system time (defaults to 2026)
    init_year = datetime.now().year
    
    current_year = init_year
    current_month = init_month
    last_day = init_day
    
    parsed_points = []
    tz_utc = timezone.utc
    tz_cst = timezone(timedelta(hours=8)) # CST UTC+8
    
    for pt in points:
        day = pt["date_day"]
        hour = pt["hour"]
        val_kt = pt["wind_speed_kt"]
        
        # Check for month transition
        if day < last_day:
            current_month += 1
            if current_month > 12:
                current_month = 1
                current_year += 1
                
        last_day = day
        
        # Construct UTC datetime
        try:
            dt_utc = datetime(current_year, current_month, day, hour, 0, 0, tzinfo=tz_utc)
            dt_cst = dt_utc.astimezone(tz_cst)
            
            parsed_points.append({
                "timestamp_cst": dt_cst.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
                "wind_speed_kt": val_kt
            })
        except Exception as e:
            print(f"Error parsing date {current_year}-{current_month}-{day} {hour}:00 : {e}")
            
    return parsed_points

def fetch_open_meteo_data(start_date_str, end_date_str):
    """
    Fetches hourly wind gust forecast from Open-Meteo API in Asia/Taipei timezone.
    Date formats: 'YYYY-MM-DD'
    """
    config = load_config()
    geo = config.get("api_params", {}).get("weather", {})
    lat = geo.get("latitude", 24.299799)
    lon = geo.get("longitude", 120.486499)
    
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "wind_gusts_10m",
        "models": "best_match",
        "timezone": "Asia/Taipei",
        "wind_speed_unit": "ms",
        "start_date": start_date_str,
        "end_date": end_date_str,
        "cell_selection": "nearest"
    }
    
    print(f"Fetching Open-Meteo from {start_date_str} to {end_date_str}...")
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        
        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        gusts = hourly.get("wind_gusts_10m", [])
        
        result = {}
        for t, g in zip(times, gusts):
            # Open-Meteo returns 'YYYY-MM-DDTHH:MM' in Asia/Taipei time.
            # Convert to standard format with +08:00 timezone
            dt = datetime.strptime(t, "%Y-%m-%dT%H:%M")
            ts_cst = dt.strftime("%Y-%m-%dT%H:%M:%S+08:00")
            result[ts_cst] = g
            
        return result
    except Exception as e:
        print(f"Failed to fetch Open-Meteo data: {e}")
        return {}

def fuse_and_save_data(gemini_output=None):
    """
    Fuses parsed Gmail chart wind speed data and Open-Meteo data,
    performs conversions, and writes to Firestore and local JSON.
    If gemini_output is None, uses existing local JSON to update Open-Meteo data.
    """
    config = load_config()
    ratio = config.get("Algorithm", {}).get("WindRatio", 1.5333)
    
    from src.config import BASE_DIR
    local_db_path = os.path.join(BASE_DIR, "data.json")

    fused_data = []
    
    if not gemini_output:
        raise ValueError("CPC data is required for update. Fallback is disabled.")
        
    # 1. Parse Gmail points to local CST timestamps
    initial_date = gemini_output["initial_date"]
    points = gemini_output["points"]
    cpc_points = parse_forecast_dates(initial_date, points)
    
    if not cpc_points:
        raise ValueError("No valid data points parsed from Gemini chart output.")
        
    # Map CPC points by timestamp
    cpc_map = {}
    for pt in cpc_points:
        ts = pt["timestamp_cst"]
        kt = pt["wind_speed_kt"]
        # Convert KT to m/s by dividing by WindRatio
        ms_val = round(kt / ratio, 2)
        cpc_map[ts] = ms_val
            
    timestamps = sorted(list(cpc_map.keys()))
    start_dt = datetime.fromisoformat(timestamps[0])
    
    # Align Open-Meteo end date with CPC data end date as requested
    end_dt = datetime.fromisoformat(timestamps[-1])
    
    start_date_str = start_dt.strftime("%Y-%m-%d")
    end_date_str = end_dt.strftime("%Y-%m-%d")
    
    # 4. Merge datasets
    # We will generate a complete hourly sequence between start and end date
    current_dt = datetime.fromisoformat(timestamps[0][:13] + ":00:00+08:00")
    
    # Set the end time for the fused data to exactly match CPC
    end_forecast_dt = datetime.fromisoformat(timestamps[-1][:13] + ":00:00+08:00")
    
    tz_cst = timezone(timedelta(hours=8))
    
    while current_dt <= end_forecast_dt:
        ts_cst = current_dt.isoformat()
        
        cpc_val = cpc_map.get(ts_cst, None)
        
        fused_data.append({
            "timestamp": ts_cst,
            "cpc_wind_speed": cpc_val,
            "open_meteo_wind_speed": None
        })
        
        current_dt += timedelta(hours=1)
            
    # Perform linear interpolation on cpc_wind_speed to fill hourly gaps
    last_valid_idx = None
    for i in range(len(fused_data)):
        if fused_data[i]["cpc_wind_speed"] is not None:
            if last_valid_idx is not None and i > last_valid_idx + 1:
                v_start = fused_data[last_valid_idx]["cpc_wind_speed"]
                v_end = fused_data[i]["cpc_wind_speed"]
                gap = i - last_valid_idx
                
                for j in range(1, gap):
                    interp_val = v_start + (v_end - v_start) * (j / gap)
                    fused_data[last_valid_idx + j]["cpc_wind_speed"] = round(interp_val, 2)
            last_valid_idx = i



    # 3. Fetch Open-Meteo hourly data
    om_map = fetch_open_meteo_data(start_date_str, end_date_str)

    # Update fused_data with Open-Meteo data
    for item in fused_data:
        ts_cst = item["timestamp"]
        om_val = om_map.get(ts_cst, None)
        if om_val is not None:
            item["open_meteo_wind_speed"] = om_val

    # Write to local JSON file (CRITICAL for PROD Github Actions workflow)
    try:
        with open(local_db_path, "w", encoding="utf-8") as f:
            json.dump(fused_data, f, indent=2, ensure_ascii=False)
        print(f"Saved fused data locally to {local_db_path}")
    except Exception as e:
        print(f"Error saving local JSON: {e}")

    # Write to Firebase RTDB
    rtdb_settings = config.get("Firebase_RTDB_Settings", {})
    # For test environment, override with env var if exists
    db_url = os.environ.get("FIREBASE_RTDB_URL", rtdb_settings.get("DbUrl"))
    db_secret = os.environ.get("FIREBASE_RTDB_SECRET", rtdb_settings.get("DbSecret"))
    
    # 🌟 動態獲取 Firebase OAuth2 Token (用來代替 DbSecret)
    access_token = None
    sa_path = get_service_account_path()
    if sa_path:
        try:
            from google.oauth2 import service_account
            import google.auth.transport.requests
            creds = service_account.Credentials.from_service_account_file(
                sa_path,
                scopes=[
                    'https://www.googleapis.com/auth/userinfo.email',
                    'https://www.googleapis.com/auth/firebase.database'
                ]
            )
            auth_req = google.auth.transport.requests.Request()
            creds.refresh(auth_req)
            access_token = creds.token
            print("[+] Successfully obtained Firebase OAuth token from service account.")
        except Exception as e:
            print(f"[Warning] Failed to generate Firebase OAuth token from service account: {e}")
            
    if db_url and (db_secret or access_token):
        print("Connecting to Firebase RTDB...")
        try:
            # We are writing to `/test/forecast_data` and `/test/forecast_metadata`
            # Wait, to support both test and prod, let's use an env var for prefix
            prefix = os.environ.get("FIREBASE_RTDB_PREFIX", "/test")
            
            if prefix == "/test":
                print("WARNING: Using default '/test' prefix for Firebase RTDB. If this is PRODUCTION, ensure FIREBASE_RTDB_PREFIX is set to an empty string ''!")
            elif prefix == "":
                print("INFO: FIREBASE_RTDB_PREFIX is empty. Writing to PRODUCTION RTDB Root!")
                
            # 依據是否有 access_token 選擇認證參數
            if access_token:
                auth_param = f"access_token={access_token}"
            else:
                auth_param = f"auth={db_secret}"
            
            # PATCH forecast_data
            url_data = f"{db_url.rstrip('/')}{prefix}/forecast_data.json?{auth_param}"
            response_data = requests.put(url_data, json=fused_data, timeout=15)
            response_data.raise_for_status()
            
            # PATCH metadata with updatedAt
            url_meta = f"{db_url.rstrip('/')}{prefix}/forecast_metadata.json?{auth_param}"
            meta_payload = {
                "updatedAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }
            response_meta = requests.patch(url_meta, json=meta_payload, timeout=15)
            response_meta.raise_for_status()
            
            print(f"Successfully uploaded {len(fused_data)} records to Firebase RTDB at {prefix}/forecast_data!")
        except Exception as e:
            print(f"Firebase RTDB upload failed: {e}")
    else:
        print("Firebase RTDB credentials missing. Upload bypassed.")
        
    # Write to Firebase Firestore (CRITICAL for PROD Github Actions workflow)
    sa_path = get_service_account_path()
    if sa_path:
        print("Connecting to Firebase Firestore (PROD)...")
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
            
            # Initialise if not already done
            if not firebase_admin._apps:
                cred = credentials.Certificate(sa_path)
                firebase_admin.initialize_app(cred)
                
            db = firestore.client()
            batch = db.batch()
            col_ref = db.collection("wind_forecasts")
            
            # Clear old documents in Firestore to keep only today's data
            docs = col_ref.stream()
            delete_count = 0
            for doc in docs:
                batch.delete(doc.reference)
                delete_count += 1
                if delete_count >= 400:
                    batch.commit()
                    batch = db.batch()
                    delete_count = 0
            if delete_count > 0:
                batch.commit()
                batch = db.batch()
                print("Cleared old wind_forecasts documents.")
            
            write_count = 0
            for record in fused_data:
                dt_obj = datetime.fromisoformat(record["timestamp"])
                doc_id = dt_obj.strftime("%Y-%m-%d_%H")
                
                doc_ref = col_ref.document(doc_id)
                doc_data = {
                    "timestamp": dt_obj,
                    "cpc_wind": record["cpc_wind_speed"],
                    "open_meteo_wind": record["open_meteo_wind_speed"],
                    "updatedAt": firestore.SERVER_TIMESTAMP
                }
                
                batch.set(doc_ref, doc_data, merge=True)
                write_count += 1
                
                if write_count >= 400:
                    batch.commit()
                    batch = db.batch()
                    write_count = 0
                    
            if write_count > 0:
                batch.commit()
                
            print(f"Successfully uploaded {len(fused_data)} records to Cloud Firestore!")
        except Exception as e:
            print(f"Firebase Firestore upload failed: {e}")
            print("Firestore upload bypassed.")
    else:
        print("Firebase service account credentials missing. Firestore upload bypassed.")

    return fused_data
