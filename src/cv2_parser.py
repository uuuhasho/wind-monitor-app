import cv2
import numpy as np
import os
from datetime import datetime, timedelta

def parse_chart_with_cv2(image_path, target_date_str):
    """
    Parses the wind forecast chart using purely OpenCV (no AI).
    image_path: Path to the processed image.
    target_date_str: MMDD string, e.g., '0530'.
    """
    print(f"Calling CV2 to analyze image {image_path}...")
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Processed image not found: {image_path}")

    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Failed to load image for CV2 parsing.")

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
    
    # Assume the top line is 50 KT and the bottom line is 0 KT.
    # Typically we find lines near Y=32 and Y=442.
    if len(horizontal_y_coords) >= 2:
        y_top = horizontal_y_coords[0] # 50 KT
        y_bottom = horizontal_y_coords[-1] # 0 KT
    else:
        # Fallback to hardcoded values if grid detection fails
        print("[Warning] Could not detect grid lines. Using fallback values.")
        y_top = 32
        y_bottom = 442

    print(f"[CV2 Parser] Y-Axis Bounds: 50KT at {y_top}, 0KT at {y_bottom}")

    # 2. Extract Red Curve (Isolate the forecast line from dotted lines)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_red1 = np.array([0, 50, 50])
    upper_red1 = np.array([10, 255, 255])
    lower_red2 = np.array([170, 50, 50])
    upper_red2 = np.array([180, 255, 255])
    red_mask = cv2.inRange(hsv, lower_red1, upper_red1) | cv2.inRange(hsv, lower_red2, upper_red2)

    # Find the largest contour by bounding box width to isolate the main curve
    cnts, _ = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        raise ValueError("No red pixels found in the image!")
        
    largest_cnt = None
    max_w = 0
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w > max_w:
            max_w = w
            largest_cnt = c
            
    clean_mask = np.zeros_like(red_mask)
    cv2.drawContours(clean_mask, [largest_cnt], -1, 255, thickness=cv2.FILLED)

    rows, cols = np.where(clean_mask > 0)
    if len(rows) == 0:
        raise ValueError("Failed to isolate the red curve!")

    # Calculate average Y for each X on the clean curve
    x_to_y = {}
    for x, y in zip(cols, rows):
        if x not in x_to_y:
            x_to_y[x] = []
        x_to_y[x].append(y)

    min_x = min(x_to_y.keys())
    max_x = max(x_to_y.keys())
    
    # Number of points is fixed at 33 for a standard CPC forecast (8 days)
    # 2 points (Day 1) + 4*7 (Days 2-8) + 3 points (Day 9) = 33 points
    num_points = 33
    dx = (max_x - min_x) / (num_points - 1)
    
    print(f"[CV2 Parser] Red curve spans X:{min_x} to {max_x}. dx={dx:.2f}")

    # 3. Calculate timestamps
    # target_date_str e.g., "0530" -> May 30. Initial field is May 29 12Z.
    current_year = datetime.now().year
    target_dt = datetime.strptime(f"{current_year}{target_date_str}", "%Y%m%d")
    initial_dt = target_dt - timedelta(days=1)
    initial_dt = initial_dt.replace(hour=12, minute=0, second=0)

    # 4. Generate points JSON
    points = []
    for i in range(num_points):
        target_x = int(round(min_x + i * dx))
        # Ensure target_x is within keys, else find nearest
        if target_x not in x_to_y:
            closest_x = min(x_to_y.keys(), key=lambda k: abs(k - target_x))
            pixel_y = np.mean(x_to_y[closest_x])
        else:
            pixel_y = np.mean(x_to_y[target_x])
            
        # Convert Y pixel to KT
        # y_bottom corresponds to 0 KT, y_top corresponds to 50 KT
        kt_value = (y_bottom - pixel_y) * (50.0 / (y_bottom - y_top))
        # Clamp between 0 and 50 just in case
        kt_value = max(0.0, min(50.0, kt_value))
        
        # Calculate time
        point_dt = initial_dt + timedelta(hours=6 * i)
        
        points.append({
            "date_day": point_dt.day,
            "hour": point_dt.hour,
            "wind_speed_kt": round(kt_value, 2)
        })

    initial_date_str = initial_dt.strftime("%HZ%d%b").upper()
    
    result_data = {
        "initial_date": f"{initial_date_str} initial field",
        "points": points
    }

    print("[CV2 Parser] Programmatic parsing completed successfully!")
    return result_data

if __name__ == "__main__":
    # Test script
    res = parse_chart_with_cv2("temp/0603中油_raw.png", "0603")
    import json
    print(json.dumps(res, indent=2))
