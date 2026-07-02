import cv2
import numpy as np
import os
from datetime import datetime, timedelta
import pytesseract
import re

# Cross-platform Tesseract path config
if os.name == 'nt':
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

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
    top_right_roi = img[0:int(height*0.15), int(width*0.5):width]
    roi_gray = cv2.cvtColor(top_right_roi, cv2.COLOR_BGR2GRAY)
    _, roi_thresh = cv2.threshold(roi_gray, 150, 255, cv2.THRESH_BINARY_INV)
    
    initial_dt = None
    initial_date_str = ""
    try:
        ocr_text = pytesseract.image_to_string(roi_thresh)
        # e.g., "00Z13JUN initial fileld"
        # 放寬正則表達式，容許 'O' 被當成 '0'
        match = re.search(r"([0-9O]{2})Z(\d{2})([A-Z]{3})", ocr_text, re.IGNORECASE)
        if match:
            z_hour_str = match.group(1).upper()
            day = int(match.group(2))
            month_str = match.group(3).upper()
            
            # OCR 容錯：空軍預報只有 00Z 和 12Z
            if "12" in z_hour_str:
                z_hour = 12
            else:
                z_hour = 0 # 00Z (包括 02Z, OOZ 等誤判)
                
            months_map = {"JAN":1, "FEB":2, "MAR":3, "APR":4, "MAY":5, "JUN":6,
                          "JUL":7, "AUG":8, "SEP":9, "OCT":10, "NOV":11, "DEC":12}
            month = months_map.get(month_str, datetime.now().month)
            year = datetime.now().year
            
            initial_dt = datetime(year, month, day, z_hour, 0, 0)
            initial_date_str = f"{z_hour:02d}Z{day:02d}{month_str}"
            print(f"[OCR] Successfully detected Initial Time: {initial_date_str}")
    except Exception as e:
        print(f"[OCR Warning] {e}")
        
    # Fallback if OCR fails
    if initial_dt is None:
        print("[Warning] OCR failed to detect initial time. Using fallback logic (Target - 1 day, 12Z).")
        current_year = datetime.now().year
        target_dt = datetime.strptime(f"{current_year}{target_date_str}", "%Y%m%d")
        initial_dt = target_dt - timedelta(days=1)
        initial_dt = initial_dt.replace(hour=12, minute=0, second=0)
        initial_date_str = initial_dt.strftime("%HZ%d%b").upper()
        
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
