import os
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")


def get_env(name):
    value = os.environ.get(name)
    return value.strip().strip("\ufeff") if value else None


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
    
    db_url_env = get_env("FIREBASE_DB_URL") or get_env("FIREBASE_RTDB_URL")
    if db_url_env:
        config["Firebase_RTDB_Settings"]["DbUrl"] = db_url_env
        
    db_secret_env = get_env("FIREBASE_DB_SECRET") or get_env("FIREBASE_RTDB_SECRET")
    if db_secret_env:
        config["Firebase_RTDB_Settings"]["DbSecret"] = db_secret_env

    # Gmail IMAP settings
    if "Gmail_IMAP_Settings" not in config:
        config["Gmail_IMAP_Settings"] = {}
    if gmail_account := get_env("GMAIL_ACCOUNT"):
        config["Gmail_IMAP_Settings"]["GmailAccount"] = gmail_account
    if gmail_password := get_env("GMAIL_APP_PASSWORD"):
        config["Gmail_IMAP_Settings"]["GmailAppPassword"] = gmail_password
    if target_sender := get_env("GMAIL_TARGET_SENDER"):
        config["Gmail_IMAP_Settings"]["TargetSender"] = target_sender

    # Line Bot settings
    if "line_bot" not in config:
        config["line_bot"] = {}
    if access_token := get_env("LINE_CHANNEL_ACCESS_TOKEN"):
        config["line_bot"]["channel_access_token"] = access_token
    if channel_secret := get_env("LINE_CHANNEL_SECRET"):
        config["line_bot"]["channel_secret"] = channel_secret

    # Algorithm settings
    if "Algorithm" not in config:
        config["Algorithm"] = {}
    if wind_ratio := get_env("ALGORITHM_WIND_RATIO"):
        try:
            config["Algorithm"]["WindRatio"] = float(wind_ratio)
        except ValueError:
            pass

    # Gemini API Key
    if gemini_key := get_env("GEMINI_API_KEY"):
        config["GeminiApiKey"] = gemini_key
    # Also support nested GeminiApiKey if it was in config.json
    elif "Algorithm" in config and "GeminiApiKey" in config["Algorithm"]:
        config["GeminiApiKey"] = str(config["Algorithm"]["GeminiApiKey"]).strip().strip("\ufeff")

    return config
