import os
import threading
import requests
from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.webhooks import MessageEvent, TextMessageContent

# Main and src modules are in the backend directory.
from src.config import get_env, load_config
from src.pob_parser import parse_pob_message
from main import run_pipeline
from src.rtdb import PipelineBusyError

config = load_config()
line_config = config.get("line_bot", {})
# 防禦性 .strip()：去除 Secret Manager 值可能含有的 BOM / 換行字元
_channel_secret = line_config.get("channel_secret", "dummy").strip()
handler = WebhookHandler(_channel_secret)

app = Flask(__name__)
CORS(app)

@app.route("/webhook", methods=['POST'])
def webhook():
    if (get_env("MAINTENANCE_MODE") or "false").lower() != "false":
        return jsonify({"status": "error", "msg": "System maintenance"}), 503
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

    # 粗篩：必須要有「台中廠／臺中廠」、「已於」與「POB」才進入背景解析
    if (
        ("台中廠" not in user_msg and "臺中廠" not in user_msg)
        or "已於" not in user_msg
        or "POB" not in user_msg.upper()
    ):
        return

    event_timestamp_ms = getattr(event, "timestamp", None)

    # ⚡ 立即啟動 background thread，讓 handle_message 在 ~0ms 返回
    # 確保 LINE 平台在 1 秒內收到 200 OK，避免 timeout
    t = threading.Thread(
        target=_process_pob_async,
        args=(user_msg, event_timestamp_ms),
        daemon=False,
    )
    t.start()


def _process_pob_async(user_msg: str, event_timestamp_ms=None):
    """在 background thread 中執行本地 Regex POB 解析，再委託 GAS 完成全流程。

    架構分工：
    - Cloud Run (本函式)：負責本地嚴格 Regex 與日期/時間邊界驗證
    - GAS (set_mode endpoint)：負責風速查找、pob_info 寫入、船期更新、換班接力

    避免雙重寫入與外部 AI 依賴，確保單一職責與資料一致性。
    """
    try:
        parsed = parse_pob_message(user_msg, event_timestamp_ms=event_timestamp_ms)
        if not parsed:
            print("[POB] 訊息未通過本地 Regex 解析或時間驗證，略過。")
            return

        pob_time = parsed["time"]
        print(f"✅ [POB] Regex 解析 POB 時間成功: {pob_time} (ship={parsed['ship_name']})")

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
    if (get_env("MAINTENANCE_MODE") or "false").lower() != "false":
        return jsonify({"status": "error", "msg": "System maintenance"}), 503
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
