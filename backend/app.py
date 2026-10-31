import os
import sys
import json
import re
import threading
import requests
import google.generativeai as genai
from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.webhooks import MessageEvent, TextMessageContent

# Fully decoupled test version: main and src are in the same directory.
from src.config import get_env, load_config
from main import run_pipeline
from src.rtdb import PipelineBusyError

config = load_config()
line_config = config.get("line_bot", {})
# 防禦性 .strip()：去除 Secret Manager 值可能含有的 BOM / 換行字元
_channel_secret = line_config.get("channel_secret", "dummy").strip()
handler = WebhookHandler(_channel_secret)

# 防禦性 .strip()：去除 Secret Manager 值可能含有的 BOM / 換行字元
gemini_api_key = config.get("GeminiApiKey", "").strip().strip("\ufeff")
if gemini_api_key:
    genai.configure(api_key=gemini_api_key)

app = Flask(__name__)
CORS(app)

@app.route("/webhook", methods=['POST'])
def webhook():
    signature = request.headers.get('X-Line-Signature', '')
    body = request.get_data(as_text=True)

    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        print("Invalid signature. Check your channel secret/token.")
        abort(400)

    return 'OK'

@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event):
    user_msg = event.message.text

    # 粗篩：必須要有「台中廠」、「已於」與「POB」才送給 Gemini 處理
    # 注意：中文字不需要 .upper()，但 POB 可能小寫，故保留 .upper() 只對英文有效
    if not all(keyword in user_msg for keyword in ["台中廠", "已於"]) or "POB" not in user_msg.upper():
        return

    # ⚡ 立即啟動 background thread，讓 handle_message 在 ~0ms 返回
    # 確保 LINE 平台在 1 秒內收到 200 OK，避免 timeout
    t = threading.Thread(target=_process_pob_async, args=(user_msg,), daemon=False)
    t.start()


def _process_pob_async(user_msg: str):
    """在 background thread 中執行 Gemini 解析，再委託 GAS 完成 POB 全流程。
    
    架構分工：
    - Cloud Run (本函式)：負責 Gemini 智慧解析 POB 時間
    - GAS (set_mode endpoint)：負責風速查找、pob_info 寫入、船期更新、換班接力
    
    避免雙重寫入，確保單一職責與資料一致性。
    """
    if not gemini_api_key:
        print("[POB] Gemini API Key missing, skipping smart parse.")
        return

    # Gemini 嚴格解析：只抓取成功進港的時間
    prompt = f"""
    請判斷以下訊息是否包含 LNG 船進台中廠的明確 POB 動態。
    如果訊息中明確指出成功的 POB 動作與具體時間，
    請回傳純 JSON 格式： {{"status": "SUCCESS", "time": "HH:MM"}}
    
    注意事項：
    - 時間格式為 HH:MM（24小時制，例如 04:55 或 13:30）
    - POB 可能與時間黏連（例如「04:55POB」），請仍正確提取時間
    - 日期可能為民國年份（例如 115/07/06），請忽略年份只提取時間
    - 如果沒有具體時間，或因為天氣等因素無法進港，請回傳 {{"status": "IGNORE"}}

    不要輸出任何說明與 markdown，只要回傳 JSON 字串。
    訊息內容：{user_msg}
    """

    try:
        model_name = config.get("Algorithm", {}).get("GeminiModelName", "gemini-flash-latest").strip()
        model = genai.GenerativeModel(
            model_name,
            generation_config={"response_mime_type": "application/json"}
        )
        response = model.generate_content(prompt)

        # 防禦性 JSON 解析：去除 Gemini 偶爾包裹的 markdown fence
        raw = response.text.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw.strip())

        if data.get("status") != "SUCCESS":
            print(f"[POB] Gemini 判斷為 IGNORE，訊息不符合條件")
            return

        pob_time = data.get("time")
        if (
            not isinstance(pob_time, str)
            or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", pob_time)
            or not "04:00" <= pob_time <= "17:00"
        ):
            print("[POB] Invalid POB time, skipping GAS delegation.")
            return
        print(f"✅ [POB] Gemini 解析 POB 時間成功: {pob_time}")

        app_password = get_env("APP_PASSWORD")
        if not app_password:
            print("[POB] APP_PASSWORD missing, skipping GAS delegation.")
            return

        # 委託 GAS set_mode endpoint 執行完整 POB 工作流：
        # 風速查找 → pob_info 寫入 → 船期更新 → 換班接力
        gas_url = "https://script.google.com/macros/s/AKfycbzlLKwqWEWqibSIUYMUYAHamsvT5oxSdVmlSprD6LhaDpCuyUkbXfrjuLB_TequEWF3/exec"
        gas_resp = requests.get(
            gas_url,
            params={"action": "set_mode", "mode": "reset", "pob_time": pob_time, "pwd": app_password},
            timeout=30,
            allow_redirects=True,
        )
        gas_resp.raise_for_status()
        gas_result = gas_resp.json()
        if not isinstance(gas_result, dict) or gas_result.get("status") != "success":
            print("[POB] GAS delegation rejected the request.")
            return
        print(f"✅ [POB] GAS set_mode 委託完成, status={gas_resp.status_code}")

    except requests.RequestException as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        detail = f" HTTP {status}" if status else ""
        print(f"❌ [POB] GAS delegation failed: {type(error).__name__}.{detail}")
    except Exception as error:
        print(f"❌ [POB] _process_pob_async failed: {type(error).__name__}")


@app.route('/update_forecast', methods=['GET', 'POST'])
def update_forecast():
    force = request.args.get('force', 'false').lower() == 'true'
    target_date = request.args.get('date', None)
    pwd = request.args.get('pwd', '')
    
    if force:
        # Check against environment variable password (set in GCP Secret Manager)
        app_password = get_env("APP_PASSWORD")
        if not app_password:
            return jsonify({"status": "error", "msg": "APP_PASSWORD is not configured"}), 503
        if pwd != app_password:
            return jsonify({"status": "error", "msg": "Invalid password"}), 403
        
    print(f"Received update request: force={force}, target_date={target_date}")
    
    # Synchronous execution to prevent Cloud Run CPU throttling
    try:
        print(f"Starting pipeline execution for date {target_date}...")
        success = run_pipeline(target_date)
        print("Finished pipeline execution.")
        
        if success:
            return jsonify({"status": "success", "msg": "Pipeline completed successfully"}), 200
        else:
            return jsonify({"status": "error", "msg": "Pipeline failed to process data"}), 500
    except PipelineBusyError:
        return jsonify({"status": "ignored", "msg": "Pipeline is already running"}), 429
    except Exception as e:
        print(f"Pipeline execution error: {e}")
        return jsonify({"status": "error", "msg": str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    # We use gunicorn in production Dockerfile
    app.run(host='0.0.0.0', port=port)
