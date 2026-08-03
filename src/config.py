import os
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
SA_PATH = os.path.join(BASE_DIR, "service_account.json")

def load_config():
    config = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            print(f"Error loading config.json: {e}")

    # Merge/override with environment variables if present
    # Firebase settings
    if "Firebase_RTDB_Settings" not in config:
        config["Firebase_RTDB_Settings"] = {}
    
    db_url_env = os.environ.get("FIREBASE_DB_URL") or os.environ.get("FIREBASE_RTDB_URL")
    if db_url_env:
        config["Firebase_RTDB_Settings"]["DbUrl"] = db_url_env
        
    db_secret_env = os.environ.get("FIREBASE_DB_SECRET") or os.environ.get("FIREBASE_RTDB_SECRET")
    if db_secret_env:
        config["Firebase_RTDB_Settings"]["DbSecret"] = db_secret_env

    # Gmail IMAP settings
    if "Gmail_IMAP_Settings" not in config:
        config["Gmail_IMAP_Settings"] = {}
    if os.environ.get("GMAIL_ACCOUNT"):
        config["Gmail_IMAP_Settings"]["GmailAccount"] = os.environ.get("GMAIL_ACCOUNT")
    if os.environ.get("GMAIL_APP_PASSWORD"):
        config["Gmail_IMAP_Settings"]["GmailAppPassword"] = os.environ.get("GMAIL_APP_PASSWORD")
    if os.environ.get("GMAIL_TARGET_SENDER"):
        config["Gmail_IMAP_Settings"]["TargetSender"] = os.environ.get("GMAIL_TARGET_SENDER")

    # Line Bot settings
    if "line_bot" not in config:
        config["line_bot"] = {}
    if os.environ.get("LINE_CHANNEL_ACCESS_TOKEN"):
        config["line_bot"]["channel_access_token"] = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    if os.environ.get("LINE_CHANNEL_SECRET"):
        config["line_bot"]["channel_secret"] = os.environ.get("LINE_CHANNEL_SECRET")

    # Algorithm settings
    if "Algorithm" not in config:
        config["Algorithm"] = {}
    if os.environ.get("ALGORITHM_WIND_RATIO"):
        try:
            config["Algorithm"]["WindRatio"] = float(os.environ.get("ALGORITHM_WIND_RATIO"))
        except ValueError:
            pass

    # Gemini API Key
    if os.environ.get("GEMINI_API_KEY"):
        config["GeminiApiKey"] = os.environ.get("GEMINI_API_KEY").strip().strip("\ufeff")
    # Also support nested GeminiApiKey if it was in config.json
    elif "Algorithm" in config and "GeminiApiKey" in config["Algorithm"]:
        config["GeminiApiKey"] = config["Algorithm"]["GeminiApiKey"]

    return config

def get_service_account_path():
    # 在 GCP 環境中，如果使用 default service account，我們不需要實體檔案
    # 所以如果設定了環境變數告訴我們在雲端，就回傳 None，讓 SDK 自己用 default auth
    if os.environ.get("USE_CLOUD_AUTH") == "true":
        return None
    if os.path.exists(SA_PATH):
        return SA_PATH
    return None

