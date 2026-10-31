import os
import sys
import argparse
import shutil
import uuid
from datetime import datetime, timedelta

# Add the project directory to the path so modules can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.email_receiver import download_forecast_attachment
from src.doc_parser import convert_doc_to_docx, extract_image_from_docx
from src.image_processor import remove_horizontal_red_line
from src.cv2_parser import parse_chart_with_cv2
from src.data_fusion import fuse_and_save_data
from src.config import BASE_DIR, load_config
from src.rtdb import ForecastRtdb, PipelineBusyError

LOCK_TTL_SECONDS = 300


def create_runtime_dir(owner):
    runtime_dir = os.path.join(BASE_DIR, "runtime", owner)
    os.makedirs(runtime_dir, exist_ok=False)
    return runtime_dir


def cleanup_runtime_dir(runtime_dir):
    # Only delete the run directory created by this process; source archives stay intact.
    if os.path.dirname(runtime_dir) == os.path.join(BASE_DIR, "runtime"):
        shutil.rmtree(runtime_dir, ignore_errors=True)

def run_pipeline(target_date=None):
    """
    Executes the wind forecast data pipeline.
    target_date format: MMDD (e.g. '0530')
    """
    rtdb = ForecastRtdb(load_config().get("Firebase_RTDB_Settings", {}))
    owner = str(uuid.uuid4())
    rtdb.acquire_lock(owner, LOCK_TTL_SECONDS)
    runtime_dir = None
    try:
        runtime_dir = create_runtime_dir(owner)
        return _run_pipeline_impl(target_date, runtime_dir, owner)
    finally:
        try:
            rtdb.release_lock(owner)
        except Exception as error:
            print(f"RTDB update lock release failed: {error}")
        if runtime_dir:
            cleanup_runtime_dir(runtime_dir)

def _run_pipeline_impl(target_date=None, runtime_dir=None, lock_owner=None):
    if not target_date:
        cst_time = datetime.utcnow() + timedelta(hours=8)
        target_date = cst_time.strftime("%m%d")

    print("=" * 60)
    print(f"CPC Wind Forecast Pipeline Triggered at {datetime.now().isoformat()} for date {target_date}")
    print("=" * 60)
    
    # 1. Download / Locating mail attachment
    print("\n[Step 1] Fetching forecast document...")
    gemini_output = None
    try:
        doc_path = download_forecast_attachment(target_date=target_date, save_dir=runtime_dir)
        print(f"Forecast document located at: {doc_path}")
        
        # Get filenames
        base_name = os.path.basename(doc_path).replace(".doc", "")
        temp_dir = runtime_dir
        
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
        fused_data = fuse_and_save_data(gemini_output, runtime_dir, lock_owner)
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
