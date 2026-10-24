import cv2
import numpy as np
import os
import re
import shutil
import base64
import requests
import pytesseract
from datetime import datetime, timedelta

# 跨平台安全設定 Tesseract 路徑
if os.name == 'nt':
    win_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    if os.path.exists(win_cmd):
        pytesseract.pytesseract.tesseract_cmd = win_cmd
    elif shutil.which("tesseract"):
        pytesseract.pytesseract.tesseract_cmd = shutil.which("tesseract")
else:
    # Linux / Docker 容器環境：自動尋找系統路徑下的 tesseract (如 /usr/bin/tesseract)
    linux_cmd = shutil.which("tesseract") or "/usr/bin/tesseract"
    if os.path.exists(linux_cmd):
        pytesseract.pytesseract.tesseract_cmd = linux_cmd

import atexit
import ctypes

class TesseractCAPI:
    """
    Direct C-API wrapper for tesseract50.dll.
    Provides fast, standalone OCR without requiring tesseract.exe in system PATH.
    """
    _instance = None
    
    @classmethod
    def get_instance(cls):
        if cls._instance is False:
            return None
        if cls._instance is not None:
            return cls._instance
            
        cur_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates_dll = [
            os.path.join(cur_dir, "lib", "tesseract50.dll"),
            r"C:\Users\hilla\Desktop\空軍及open-meteo陣風比對\lib\tesseract50.dll",
            r"C:\Users\hilla\Desktop\opencode桌面\WeatherForecastApp_Home\bin\Release\net8.0-windows\win-x64\x64\tesseract50.dll",
            r"C:\Users\hilla\Desktop\opencode桌面\WeatherForecastApp_Home\bin\Debug\net8.0-windows\win-x64\x64\tesseract50.dll",
        ]
        candidates_tessdata = [
            os.path.join(cur_dir, "tessdata"),
            r"C:\Users\hilla\Desktop\空軍及open-meteo陣風比對\tessdata",
            r"C:\Users\hilla\Desktop\opencode桌面\WeatherForecastApp_Home\tessdata",
        ]
        
        dll_found = None
        for p in candidates_dll:
            if os.path.exists(p):
                dll_found = p
                break
                
        tessdata_found = None
        for p in candidates_tessdata:
            if os.path.exists(os.path.join(p, "eng.traineddata")):
                tessdata_found = p
                break
                
        if not dll_found or not tessdata_found:
            cls._instance = False
            return None
            
        try:
            lib_dir = os.path.dirname(dll_found)
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(lib_dir)
            tess = ctypes.cdll.LoadLibrary(dll_found)
            
            tess.TessBaseAPICreate.restype = ctypes.c_void_p
            tess.TessBaseAPIInit3.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
            tess.TessBaseAPIInit3.restype = ctypes.c_int
            tess.TessBaseAPISetImage.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
            tess.TessBaseAPIGetUTF8Text.argtypes = [ctypes.c_void_p]
            tess.TessBaseAPIGetUTF8Text.restype = ctypes.c_void_p
            tess.TessDeleteText.argtypes = [ctypes.c_void_p]
            tess.TessBaseAPIEnd.argtypes = [ctypes.c_void_p]
            tess.TessBaseAPIDelete.argtypes = [ctypes.c_void_p]
            
            api = tess.TessBaseAPICreate()
            init_ret = tess.TessBaseAPIInit3(api, tessdata_found.encode("mbcs"), b"eng")
            if init_ret != 0:
                tess.TessBaseAPIDelete(api)
                cls._instance = False
                return None
                
            def _cleanup():
                try:
                    tess.TessBaseAPIEnd(api)
                    tess.TessBaseAPIDelete(api)
                except Exception:
                    pass
            atexit.register(_cleanup)
            
            cls._instance = (tess, api)
            return cls._instance
        except Exception as e:
            print(f"[Tesseract Init Warning] Failed to initialize Tesseract C-API: {e}")
            cls._instance = False
            return None

    @classmethod
    def ocr_image(cls, bgr_or_gray_img):
        inst = cls.get_instance()
        if not inst:
            try:
                return pytesseract.image_to_string(bgr_or_gray_img)
            except Exception:
                return ""
                
        tess, api = inst
        if len(bgr_or_gray_img.shape) == 3:
            gray = cv2.cvtColor(bgr_or_gray_img, cv2.COLOR_BGR2GRAY)
        else:
            gray = bgr_or_gray_img
            
        h, w = gray.shape
        tess.TessBaseAPISetImage(api, gray.tobytes(), w, h, 1, w)
        text_ptr = tess.TessBaseAPIGetUTF8Text(api)
        if not text_ptr:
            return ""
        text = ctypes.string_at(text_ptr).decode("utf-8", errors="ignore")
        tess.TessDeleteText(text_ptr)
        return text

def get_initial_time_via_gemini_vision(crop_img):
    """
    Uses Gemini 2.5 Flash via REST API (requests + base64) to OCR
    the initial forecast time (e.g. '00Z25SEP', '12Z24SEP').
    Returns string tag if matched, else None.
    """
    try:
        from src.config import load_config
        config = load_config()
        api_key = config.get("GeminiApiKey", "").strip().strip("\ufeff")
        if not api_key:
            return None
        
        _, buf = cv2.imencode(".png", crop_img)
        b64_img = base64.b64encode(buf.tobytes()).decode("utf-8")
        
        model_name = config.get("Algorithm", {}).get("GeminiModelName", "gemini-2.5-flash").strip()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        payload = {
            "contents": [{
                "parts": [
                    {
                        "text": "This is the top-right header area of a weather forecast chart. "
                                "Extract the initial time tag (format: 2 digits + 'Z' + 2 digits + 3 uppercase month letters, "
                                "such as '00Z25SEP' or '12Z24SEP'). Reply ONLY with the matched tag (e.g. 00Z25SEP). "
                                "If completely unreadable, reply 'UNKNOWN'."
                    },
                    {"inline_data": {"mime_type": "image/png", "data": b64_img}}
                ]
            }]
        }
        resp = requests.post(url, json=payload, timeout=8)
        if resp.status_code == 200:
            res_data = resp.json()
            cand = res_data.get("candidates", [])
            if cand:
                text = cand[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                match = re.search(r"([0-9O]{2})\s*Z\s*(\d{2})\s*([A-Z]{3})", text, re.IGNORECASE)
                if match:
                    zh = match.group(1).upper().replace("O", "0")
                    day = match.group(2)
                    mon = match.group(3).upper()
                    result_tag = f"{zh}Z{day}{mon}"
                    print(f"[Gemini Vision OCR] Successfully extracted initial time: {result_tag}")
                    return result_tag
        else:
            print(f"[Gemini Vision OCR Notice] HTTP {resp.status_code}: {resp.text[:100]}")
    except Exception as e:
        print(f"[Gemini Vision OCR Warning] {e}")
    return None

def parse_chart_with_cv2(image_path, target_date_str):
    """
    Parses the wind forecast chart using OpenCV + Tesseract OCR.
    image_path: Path to the processed image.
    target_date_str: MMDD string, e.g., '0530'.
    """
    print(f"Calling CV2 + OCR to analyze image {image_path}...")
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Processed image not found: {image_path}")

    img = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
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
        
    clean_mask = np.zeros_like(red_mask)
    for c in cnts:
        # Keep contours that are reasonably wide or have a significant area
        # This prevents picking up red noise spots/text, but keeps broken line segments
        x, y, w, h = cv2.boundingRect(c)
        if w > 40 or h > 40 or cv2.contourArea(c) > 100:
            cv2.drawContours(clean_mask, [c], -1, 255, thickness=cv2.FILLED)

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
    
    # 3. Determine Chart Boundaries and Physical Grid Nodes
    # Find vertical grid lines to determine the true chart width
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
    detect_vert = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, vert_kernel, iterations=2)
    vert_cnts, _ = cv2.findContours(detect_vert, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    vert_x_coords = []
    for c in vert_cnts:
        vx, vy, vw, vh = cv2.boundingRect(c)
        if vh > 100: # Valid vertical grid line
            vert_x_coords.append(vx + vw//2)
            
    if len(vert_x_coords) >= 2:
        chart_min_x = min(vert_x_coords)
        chart_max_x = max(vert_x_coords)
    else:
        print("[Warning] Could not detect vertical grid lines. Using fallback values.")
        chart_min_x = 80
        chart_max_x = 780
        
    chart_width = chart_max_x - chart_min_x
    print(f"[CV2 Parser] Chart Grid Bounds: X:{chart_min_x} to {chart_max_x}, Width={chart_width}")

    # Physical Autocorrelation on Red Curve Spacing (23 points for 5.5 days vs 33 points for 8 days)
    col_sums = np.sum(clean_mask > 0, axis=0)
    col_sums = col_sums - np.mean(col_sums)
    autocorr = np.correlate(col_sums, col_sums, mode='full')
    autocorr = autocorr[autocorr.size // 2:]

    lag_33 = int(round(chart_width / 32))  # expected spacing for 33-point (8-day) chart
    lag_23 = int(round(chart_width / 22))  # expected spacing for 23-point (5.5-day) chart

    corr_33 = float(autocorr[lag_33]) if lag_33 < len(autocorr) else -np.inf
    corr_23 = float(autocorr[lag_23]) if lag_23 < len(autocorr) else -np.inf

    autocorr_points = 33 if corr_33 >= corr_23 else 23
    print(f"[CV2 Parser] Autocorrelation vote: 33pts(lag={lag_33},corr={corr_33:.0f}) vs 23pts(lag={lag_23},corr={corr_23:.0f}) -> {autocorr_points} points")

    # 4. OCR to find Initial Time (Top Right: Initial Field)
    crop_w = int(width * 0.4)
    crop_x = width - crop_w
    crop_h = min(45, height)
    top_right_roi = img[0:crop_h, crop_x:width]
    
    initial_dt = None
    initial_date_str = ""
    detected_z = None
    try:
        ocr_text = TesseractCAPI.ocr_image(top_right_roi)
        # Matches e.g. "00Z18SEP initial fileld", "12Z17SEP initial field"
        match = re.search(r"([0-9O]{2})\s*Z\s*(\d{2})\s*([A-Z]{3})", ocr_text, re.IGNORECASE)
        if match:
            z_hour_str = match.group(1).upper().replace("O", "0")
            day = int(match.group(2))
            month_str = match.group(3).upper()
            z_hour = 12 if "12" in z_hour_str else 0
            detected_z = f"{z_hour:02d}Z"
            months_map = {"JAN":1, "FEB":2, "MAR":3, "APR":4, "MAY":5, "JUN":6,
                          "JUL":7, "AUG":8, "SEP":9, "OCT":10, "NOV":11, "DEC":12}
            month = months_map.get(month_str, datetime.now().month)
            year = datetime.now().year
            initial_dt = datetime(year, month, day, z_hour, 0, 0)
            initial_date_str = f"{z_hour:02d}Z{day:02d}{month_str}"
            print(f"[OCR Tesseract] Successfully detected Initial Time: {initial_date_str}")
        else:
            print(f"[OCR Notice] Tesseract title did not match (Raw: {repr(ocr_text.strip())}). Trying Gemini Vision...")
            gemini_tag = get_initial_time_via_gemini_vision(top_right_roi)
            if gemini_tag:
                match_g = re.search(r"([0-9]{2})Z(\d{2})([A-Z]{3})", gemini_tag)
                if match_g:
                    z_hour = int(match_g.group(1))
                    day = int(match_g.group(2))
                    month_str = match_g.group(3).upper()
                    detected_z = f"{z_hour:02d}Z"
                    months_map = {"JAN":1, "FEB":2, "MAR":3, "APR":4, "MAY":5, "JUN":6,
                                  "JUL":7, "AUG":8, "SEP":9, "OCT":10, "NOV":11, "DEC":12}
                    month = months_map.get(month_str, datetime.now().month)
                    year = datetime.now().year
                    initial_dt = datetime(year, month, day, z_hour, 0, 0)
                    initial_date_str = f"{z_hour:02d}Z{day:02d}{month_str}"
                    print(f"[OCR Gemini] Successfully detected Initial Time: {initial_date_str}")
    except Exception as e:
        print(f"[OCR Warning] {e}")

    # 5. OCR on Bottom Time Axis to verify 6-HR intervals and total duration
    bottom_y = int(height * 0.948)
    bottom_x = int(width * 0.07)
    crop_bottom = img[bottom_y:height, bottom_x:width]
    
    scale = 3
    pad = 30
    enlarged = cv2.resize(crop_bottom, (crop_bottom.shape[1] * scale, crop_bottom.shape[0] * scale), interpolation=cv2.INTER_CUBIC)
    padded = cv2.copyMakeBorder(enlarged, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=[255, 255, 255])
    
    bottom_ocr_matches = []
    try:
        bottom_text = TesseractCAPI.ocr_image(padded)
        bottom_ocr_matches = re.findall(r'(00|06|12|18)', bottom_text)
        print(f"[OCR Bottom Axis] Found {len(bottom_ocr_matches)} intervals: {bottom_ocr_matches[:4]} ... {bottom_ocr_matches[-3:] if len(bottom_ocr_matches) > 3 else ''}")
    except Exception as e:
        print(f"[OCR Bottom Axis Warning] {e}")

    # 6. Multi-Signal Voting & Consensus Resolution
    # Step 6a: Node count determination
    if len(bottom_ocr_matches) in (23, 33):
        num_points = len(bottom_ocr_matches)
        print(f"[CV2 Parser] Node count confirmed by Bottom Axis OCR: {num_points} points ({(num_points-1)/4.0:.1f} days)")
    else:
        num_points = autocorr_points
        print(f"[CV2 Parser] Node count confirmed by Autocorrelation: {num_points} points ({(num_points-1)/4.0:.1f} days)")

    # Step 6b: Determine whether forecast is 00Z or 12Z
    is_00z = None
    if detected_z == "00Z":
        is_00z = True
    elif detected_z == "12Z":
        is_00z = False
    elif bottom_ocr_matches and bottom_ocr_matches[0] == "00":
        is_00z = True
    elif bottom_ocr_matches and bottom_ocr_matches[0] == "12":
        is_00z = False
    else:
        # Ultimate fallback based on physical grid nodes:
        # In Air Force marine forecasts, 23 points = 5.5 days is ALWAYS 00Z!
        # 33 points = 8.0 days is ALWAYS 12Z!
        is_00z = (num_points == 23)
        print(f"[Fallback Time] OCR inconclusive. Decided is_00z={is_00z} via physical point count ({num_points} pts).")

    # Step 6c: Enforce consistency between 00Z/12Z and num_points
    if is_00z:
        num_points = 23
    else:
        num_points = 33

    # Step 6d: Resolve initial_dt
    current_year = datetime.now().year
    target_dt = datetime.strptime(f"{current_year}{target_date_str}", "%Y%m%d")
    
    if initial_dt is None:
        if is_00z:
            # 00Z starts on target date
            initial_dt = target_dt.replace(hour=0, minute=0, second=0)
        else:
            # 12Z starts on target date - 1 day
            initial_dt = (target_dt - timedelta(days=1)).replace(hour=12, minute=0, second=0)
        initial_date_str = initial_dt.strftime("%HZ%d%b").upper()
        print(f"[Resolved Time] Inferred initial time: {initial_date_str} (is_00z={is_00z})")
    else:
        # Validate initial_dt with resolved is_00z
        expected_hour = 0 if is_00z else 12
        if initial_dt.hour != expected_hour:
            print(f"[Time Alignment Alert] Overriding initial_dt hour {initial_dt.hour} -> {expected_hour} to match is_00z={is_00z}")
            initial_dt = initial_dt.replace(hour=expected_hour)
            initial_date_str = initial_dt.strftime("%HZ%d%b").upper()

    print(f"[CV2 Parser Decision] Final: {initial_date_str} initial field, points: {num_points}, is_00z: {is_00z}")

    dx = chart_width / (num_points - 1)
    print(f"[CV2 Parser] Chart spans X:{chart_min_x} to {chart_max_x}. dx={dx:.2f}, points={num_points}")

    # 5. Generate points JSON
    points = []
    for i in range(num_points):
        target_x = int(round(chart_min_x + i * dx))
        # Handle cases where the red curve is missing at target_x
        if target_x not in x_to_y:
            left_xs = [k for k in x_to_y.keys() if k < target_x]
            right_xs = [k for k in x_to_y.keys() if k > target_x]
            
            if left_xs and right_xs:
                left_x = max(left_xs)
                right_x = min(right_xs)
                y_left = np.mean(x_to_y[left_x])
                y_right = np.mean(x_to_y[right_x])
                # Linear interpolation between the gap
                pixel_y = y_left + (y_right - y_left) * ((target_x - left_x) / (right_x - left_x))
            elif left_xs:
                pixel_y = np.mean(x_to_y[max(left_xs)])
            elif right_xs:
                pixel_y = np.mean(x_to_y[min(right_xs)])
            else:
                pixel_y = y_bottom # Fallback

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
    res = parse_chart_with_cv2("temp/0613中油_raw.png", "0613")
    import json
    print(json.dumps(res, indent=2))
