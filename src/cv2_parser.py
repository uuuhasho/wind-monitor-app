import cv2
import numpy as np
import os
import re
import requests
import base64
from datetime import datetime, timedelta

def get_initial_time_via_gemini(image_path, api_key):
    """
    Calls Gemini 2.5 Flash REST API to perform OCR on the top-right corner.
    Features auto MIME-type detection and transient network retries.
    """
    # 1. Dynamically detect MIME-Type
    ext = os.path.splitext(image_path)[1].lower()
    mime_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
    
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    
    prompt = (
        "This is a weather forecast chart. Please look at the text in the top-right corner. "
        "It usually looks like '00Z13JUN' or '12Z02JUL' followed by 'initial field' or similar text. "
        "Please extract this time code (e.g., '00Z13JUN' or '12Z02JUL') and return ONLY the time code, "
        "such as '00Z13JUN'. Do not include any other characters, explanation, or markdown formatting."
    )
    
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {
                    "inlineData": {
                        "mimeType": mime_type,
                        "data": image_data
                    }
                }
            ]
        }]
    }
    
    # 2. Network Retry Mechanism (3 attempts)
    max_retries = 3
    last_err = None
    for attempt in range(max_retries):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=20)
            response.raise_for_status()
            result = response.json()
            text = result["candidates"][0]["content"]["parts"][0]["text"].strip()
            return text.replace('"', '').replace("'", "").strip()
        except Exception as e:
            last_err = e
            print(f"[Warning] Gemini API attempt {attempt+1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                import time
                time.sleep(2)
                
    raise ValueError(f"Gemini API failed after {max_retries} attempts. Last error: {last_err}")



def parse_chart_with_cv2(image_path, target_date_str):
    """
    Parses the wind forecast chart using OpenCV + Tesseract OCR.
    image_path: Path to the processed image.
    target_date_str: MMDD string, e.g., '0530'.
    """
    print(f"Calling CV2 + OCR to analyze image {image_path}...")
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Processed image not found: {image_path}")

    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Failed to load image for CV2 parsing.")

    height, width, _ = img.shape

    # 1. Detect Grid lines (Y-axis bounds)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    detect_horizontal = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)
    cnts, _ = cv2.findContours(detect_horizontal, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    horizontal_y_coords = []
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w > 200: # Valid grid line
            horizontal_y_coords.append(y + h//2)
            
    horizontal_y_coords = sorted(list(set(horizontal_y_coords)))
    
    if len(horizontal_y_coords) >= 2:
        y_top = horizontal_y_coords[0] # 50 KT
        y_bottom = horizontal_y_coords[-1] # 0 KT
    else:
        print("[Warning] Could not detect grid lines. Using fallback values.")
        y_top = 32
        y_bottom = 442

    print(f"[CV2 Parser] Y-Axis Bounds: 50KT at {y_top}, 0KT at {y_bottom}")

    # 2. Extract Red Curve
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_red1 = np.array([0, 50, 50])
    upper_red1 = np.array([10, 255, 255])
    lower_red2 = np.array([170, 50, 50])
    upper_red2 = np.array([180, 255, 255])
    red_mask = cv2.inRange(hsv, lower_red1, upper_red1) | cv2.inRange(hsv, lower_red2, upper_red2)

    cnts, _ = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        raise ValueError("No red pixels found in the image!")
        
    largest_cnt = max(cnts, key=lambda c: cv2.boundingRect(c)[2])
    clean_mask = np.zeros_like(red_mask)
    cv2.drawContours(clean_mask, [largest_cnt], -1, 255, thickness=cv2.FILLED)

    rows, cols = np.where(clean_mask > 0)
    if len(rows) == 0:
        raise ValueError("Failed to isolate the red curve!")

    x_to_y = {}
    for x, y in zip(cols, rows):
        if x not in x_to_y:
            x_to_y[x] = []
        x_to_y[x].append(y)

    min_x = min(x_to_y.keys())
    max_x = max(x_to_y.keys())
    total_width = max_x - min_x
    
    # 3. OCR to find Initial Time
    initial_dt = None
    initial_date_str = ""
    
    # Load Gemini API Key: Priority 1: Environment variable, Priority 2: config.json
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        try:
            from src.config import load_config
            config = load_config()
            api_key = config.get("Algorithm", {}).get("GeminiApiKey")
        except Exception as e:
            print(f"[Warning] Failed to load config.json: {e}")
        
    if not api_key:
        raise ValueError("GEMINI_API_KEY is missing! Cannot run forecast pipeline without Gemini API Key.")
        
    try:
        # Call Gemini 2.5 Flash for precise OCR
        detected_time = get_initial_time_via_gemini(image_path, api_key)
        print(f"[Gemini 2.5 Flash OCR] Successfully detected: {detected_time}")
        
        # Parse the output (expected format "00Z01JUL")
        match = re.search(r"([0-9]{2})Z(\d{2})([A-Z]{3})", detected_time, re.IGNORECASE)
        if match:
            z_hour = int(match.group(1))
            day = int(match.group(2))
            month_str = match.group(3).upper()
            
            months_map = {"JAN":1, "FEB":2, "MAR":3, "APR":4, "MAY":5, "JUN":6,
                          "JUL":7, "AUG":8, "SEP":9, "OCT":10, "NOV":11, "DEC":12}
            
            if month_str not in months_map:
                raise ValueError(f"Unrecognized month abbreviation: '{month_str}' in detected time '{detected_time}'")
                
            month = months_map[month_str]
            year = datetime.now().year
            
            initial_dt = datetime(year, month, day, z_hour, 0, 0)
            initial_date_str = f"{z_hour:02d}Z{day:02d}{month_str}"
        else:
            raise ValueError(f"Gemini output '{detected_time}' does not match expected MMDD hour format.")
            
    except Exception as e:
        print(f"[-] Gemini OCR failed. Pipeline aborted (No Fallback Allowed): {e}")
        raise e
        
    # 4. Determine Number of Points using Plan B (Dynamic Feature Thickness Detection via Autocorrelation)
    # Project the red mask vertically to get the thickness profile
    col_sums = np.sum(clean_mask > 0, axis=0)
    col_sums = col_sums - np.mean(col_sums)
    autocorr = np.correlate(col_sums, col_sums, mode='full')
    autocorr = autocorr[autocorr.size // 2:]
    
    # Ignore the first few pixels (lag 0) and find the first major peak
    # dx is typically around 20~24 (for 33 points) or 30~34 (for 23 points)
    autocorr[:15] = 0 
    
    # Restrict search for dx to reasonable ranges: 15 to 45
    dx_peak = np.argmax(autocorr[15:45]) + 15
    
    # Calculate number of points dynamically
    num_points = int(round(total_width / dx_peak)) + 1
    
    print(f"[Heuristic Plan B] Detected dx={dx_peak} via dynamic feature thickness (Autocorrelation).")
    
    # Use the detected num_points, but cap to closest expected (23 or 33) to be safe if desired,
    # or just trust the dynamic point count. The air force charts are usually 23 or 33 points.
    if abs(num_points - 23) < abs(num_points - 33):
        num_points = 23
    else:
        num_points = 33

    dx = total_width / (num_points - 1)
    print(f"[CV2 Parser] Red curve spans X:{min_x} to {max_x}. dx={dx:.2f}, points={num_points}")

    # 5. Generate points JSON
    points = []
    for i in range(num_points):
        target_x = int(round(min_x + i * dx))
        if target_x not in x_to_y:
            closest_x = min(x_to_y.keys(), key=lambda k: abs(k - target_x))
            pixel_y = np.mean(x_to_y[closest_x])
        else:
            pixel_y = np.mean(x_to_y[target_x])
            
        kt_value = (y_bottom - pixel_y) * (50.0 / (y_bottom - y_top))
        kt_value = max(0.0, min(50.0, kt_value))
        
        point_dt = initial_dt + timedelta(hours=6 * i)
        
        points.append({
            "date_day": point_dt.day,
            "hour": point_dt.hour,
            "wind_speed_kt": round(kt_value, 2)
        })

    result_data = {
        "initial_date": initial_date_str + " initial field",
        "points": points
    }

    print("[CV2 Parser] Programmatic parsing completed successfully!")
    return result_data

if __name__ == "__main__":
    # Test script
    res = parse_chart_with_cv2("temp/0612中油_raw.png", "0612")
    import json
    print(json.dumps(res, indent=2))
