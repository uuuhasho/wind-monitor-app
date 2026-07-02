import os
import sys
import argparse
import requests
from datetime import datetime, timedelta, timezone

# Add the project directory to the path so modules can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.email_receiver import download_forecast_attachment
from src.doc_parser import convert_doc_to_docx, extract_image_from_docx
from src.image_processor import remove_horizontal_red_line
from src.cv2_parser import parse_chart_with_cv2
from src.data_fusion import fuse_and_save_data

def reset_rtdb_updating_state():
    """
    Resets the 'forecast_updating' flag to False on Firebase Realtime Database
    to unlock the manual update button in the frontend.
    """
    try:
        from src.config import load_config
        config = load_config()
        rtdb_settings = config.get("Firebase_RTDB_Settings", {})
        db_url = rtdb_settings.get("DbUrl")
        db_secret = rtdb_settings.get("DbSecret")
        
        if not db_url or not db_secret:
            print("\n[RTDB Reset] Firebase RTDB settings not configured in config.json. Skipping state reset.")
            return
            
        prefix = os.environ.get("FIREBASE_RTDB_PREFIX", "")
        url = f"{db_url.rstrip('/')}{prefix}/active_status.json?auth={db_secret}"
        payload = {
            "forecast_updating": False
        }
        print(f"\n[RTDB Reset] Sending PATCH to Firebase RTDB to unlock updates...")
        response = requests.patch(url, json=payload, timeout=10)
        response.raise_for_status()
        print("[RTDB Reset] Successfully reset forecast_updating to False in RTDB.")
    except Exception as e:
        print(f"\n[RTDB Reset] Error resetting RTDB updating state: {e}")

def cleanup_old_files(target_date):
    print("\n[Cleanup] Removing old .doc files and temp files...")
    base_dir = os.path.dirname(os.path.abspath(__file__))
    temp_dir = os.path.join(base_dir, "temp")
    
    # 1. Root directory .doc files
    for filename in os.listdir(base_dir):
        if filename.endswith(".doc") and "中油" in filename:
            if target_date not in filename:
                try:
                    os.remove(os.path.join(base_dir, filename))
                    print(f"Removed old file: {filename}")
                except Exception as e:
                    print(f"Failed to remove {filename}: {e}")
                    
    # 2. Temp directory files
    if os.path.exists(temp_dir):
        for filename in os.listdir(temp_dir):
            if target_date not in filename:
                try:
                    os.remove(os.path.join(temp_dir, filename))
                    print(f"Removed old temp file: {filename}")
                except Exception as e:
                    print(f"Failed to remove temp file {filename}: {e}")

def run_pipeline(target_date=None):
    """
    Executes the wind forecast data pipeline.
    target_date format: MMDD (e.g. '0530')
    """
    try:
        return _run_pipeline_impl(target_date)
    finally:
        reset_rtdb_updating_state()

def _run_pipeline_impl(target_date=None):
    if not target_date:
        cst_time = datetime.now(timezone.utc) + timedelta(hours=8)
        target_date = cst_time.strftime("%m%d")

    print("=" * 60)
    print(f"CPC Wind Forecast Pipeline Triggered at {datetime.now().isoformat()} for date {target_date}")
    print("=" * 60)
    
    cleanup_old_files(target_date)
    
    # 1. Download / Locating mail attachment
    print("\n[Step 1] Fetching forecast document...")
    gemini_output = None
    try:
        doc_path = download_forecast_attachment(target_date=target_date)
        print(f"Forecast document located at: {doc_path}")
        
        # Get filenames
        base_name = os.path.basename(doc_path).replace(".doc", "")
        temp_dir = os.path.join(os.path.dirname(doc_path), "temp")
        os.makedirs(temp_dir, exist_ok=True)
        
        docx_path = os.path.join(temp_dir, f"{base_name}.docx")
        raw_img_path = os.path.join(temp_dir, f"{base_name}_raw.png")
        processed_img_path = os.path.join(temp_dir, f"{base_name}_processed.png")
        
        # 2. Document conversion and image extraction
        print("\n[Step 2] Converting doc and extracting image...")
        convert_doc_to_docx(doc_path, docx_path)
        extract_image_from_docx(docx_path, raw_img_path)
            
        # 3. OpenCV image processing (Skipped - cv2_parser now handles raw image directly)
        print("\n[Step 3] Preprocessing image (Skipped - using robust contour detection)...")
            
        # 4. Programmatic CV2 chart recognition
        print("\n[Step 4] Calling CV2 Parser for chart parsing...")
        # cv2_parser now reads raw_img_path and dynamically extracts the largest red contour
        gemini_output = parse_chart_with_cv2(raw_img_path, target_date)
        print("CV2 raw parser output:")
        print(gemini_output)
    except Exception as e:
        print(f"Error in Step 1-4 (CPC Forecast Processing): {e}")
        print("Pipeline aborted because today's CPC data is missing or could not be parsed.")
        return False
        
    # 5. Open-Meteo & OpenWeather fetching, timezone/unit alignment and data writing
    print("\n[Step 5] Performing data fusion and writing to database...")
    try:
        fused_data = fuse_and_save_data(gemini_output)
        print(f"Data fusion completed! Total records saved: {len(fused_data)}")
        if fused_data:
            print(f"First record: {fused_data[0]}")
            print(f"Last record: {fused_data[-1]}")
    except Exception as e:
        print(f"Error in Step 5: {e}")
        return False
        
    print("\n" + "=" * 60)
    print("Pipeline Execution Completed Successfully!")
    print("=" * 60)
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPC Wind Forecast Automation Pipeline")
    parser.add_argument("--date", type=str, help="Target date in MMDD format (e.g. 0530)", default=None)
    args = parser.parse_args()
    
    success = run_pipeline(target_date=args.date)
    if not success:
        sys.exit(1)
