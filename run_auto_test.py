import os
import time
import json
import requests
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright, expect
from google.oauth2 import service_account
import google.auth.transport.requests

# --- 核心設定參數 ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_HTML_PATH = "file:///" + os.path.abspath(os.path.join(SCRIPT_DIR, "index_test.html")).replace("\\", "/")
GAS_API_URL = "https://script.google.com/macros/s/AKfycbzlLKwqWEWqibSIUYMUYAHamsvT5oxSdVmlSprD6LhaDpCuyUkbXfrjuLB_TequEWF3/exec"
TEST_PASSWORD = "1234"
TEMP_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "temp"))

# 🌟 測試版新 Firebase 專案 Realtime Database URL
DB_URL = "https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/"

# 🌟 從 service_account.json 動態獲取 Firebase OAuth2 Token
def get_firebase_token():
    try:
        sa_path = os.path.join(SCRIPT_DIR, "service_account.json")
        creds = service_account.Credentials.from_service_account_file(
            sa_path,
            scopes=[
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/firebase.database'
            ]
        )
        auth_req = google.auth.transport.requests.Request()
        creds.refresh(auth_req)
        return creds.token
    except Exception as e:
        print(f"[-] 獲取 Firebase OAuth Token 失敗: {e}")
        return None

# 確保截圖目錄存在
if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)

print(f"[*] 測試網頁路徑: {LOCAL_HTML_PATH}")
print(f"[*] 測試 API 網址: {GAS_API_URL}")
print(f"[*] 暫存截圖目錄: {TEMP_DIR}")

# 狀態快照字典
test_results = {
    "step1_reset": False,
    "step2_wrong_password": False,
    "step3_correct_password": False,
    "step4_edit_schedule_sorting": False,
    "step5_start_monitoring": False,
    "step6_simulate_pob": False,
    "step7_auto_handoff": False,
    "step8_manual_cannot_entry": False,
    "step9_archive_test": False,
    "step10_delay_inheritance": False
}

def clean_database():
    """ 透過 GAS API 清除資料庫，重置測試環境 """
    print("[*] 正在透過 GAS 進行測試環境初始化歸檔與重置...")
    token = get_firebase_token()
    url = f"{GAS_API_URL}?action=archive_test&pwd={TEST_PASSWORD}&fb_token={token}"
    try:
        response = requests.get(url, timeout=15)
        print(f"[*] Response Status Code: {response.status_code}")
        try:
            res_json = response.json()
        except Exception as json_err:
            print(f"[-] JSON Decode Error: {json_err}. Raw response: {response.text[:200]}")
            return False
            
        print(f"[+] GAS 初始化響應: {res_json}")
        if res_json.get("status") == "success":
            test_results["step1_reset"] = True
            return True
        else:
            print(f"[-] 初始化失敗: {res_json.get('msg')}")
            return False
    except Exception as e:
        print(f"[-] 初始化連線失敗: {e}")
        return False

def run_tests():
    # 1. 執行環境重置
    if not clean_database():
        print("[-] 無法重置測試環境資料庫，停止測試。")
        return

    # 取得今日 M/D 格式 (如 6/14)
    today_md = f"{datetime.now().month}/{datetime.now().day}"
    print(f"[*] 今日日期 (M/D): {today_md}")

    # 2. 啟動 Playwright 進行有頭瀏覽器自動測試
    with sync_playwright() as p:
        print("[*] 啟動 Chromium 瀏覽器 (有頭模式)...")
        browser = p.chromium.launch(headless=False, args=["--start-maximized"])
        
        # 建立大視窗頁面
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        # 監聽 console 輸出
        def on_console_message(msg):
            if msg.type in ["log", "info", "warn", "error"]:
                print(f"[Browser Console] {msg.type.upper()}: {msg.text}")
        page.on("console", on_console_message)

        # 處理 Dialogs (Alert, Confirm, Prompt)
        dialog_records = []
        def handle_dialog(dialog):
            print(f"[Browser Dialog] Type: {dialog.type}, Message: {dialog.message}")
            dialog_records.append({"type": dialog.type, "message": dialog.message})
            
            # 自動回答 POB 模擬 prompt
            if dialog.type == "prompt":
                if "請輸入要模擬 POB 的船名" in dialog.message:
                    dialog.accept("TEST-W12")
                elif "請輸入 POB 時間" in dialog.message:
                    dialog.accept("14:15")
                elif "請輸入操作密碼" in dialog.message:
                    dialog.accept(TEST_PASSWORD)
                else:
                    dialog.accept("")
            else:
                dialog.accept() # Accept alert & confirm

        page.on("dialog", handle_dialog)

        # 開啟測試網頁
        print("[*] 載入 index_test.html...")
        page.goto(LOCAL_HTML_PATH)
        page.wait_for_timeout(2000) # 等待 Firebase 載入

        # 拍照存檔
        page.screenshot(path=os.path.join(TEMP_DIR, "step1_page_loaded.png"))
        print("[+] 網頁加載完成")

        # --- 3. 測試場景：輸入錯誤密碼 ---
        print("[*] 測試場景：輸入錯誤密碼...")
        # 點擊「船期表」觸發密碼視窗
        page.click('h3:has-text("船期表")')
        page.wait_for_selector("#pwdModal", state="visible")
        
        # 輸入錯誤密碼
        page.fill("#modalPwdInput", "9999")
        page.click("#pwdModal .btn-confirm")
        
        # 等待背景 GAS 驗證回傳，驗證失敗會跳出警告彈窗，隨後自動強制關閉
        page.wait_for_timeout(3000)
        
        # 驗證是否出現過「密碼錯誤」的 alert
        has_error_alert = any("密碼錯誤" in d["message"] for d in dialog_records if d["type"] == "alert")
        is_adjust_modal_closed = not page.is_visible("#scheduleAdjustModal")
        
        if has_error_alert and is_adjust_modal_closed:
            print("[+] 驗證成功：輸入錯誤密碼後已自動攔截、顯示錯誤 Alert 並強制關閉視窗！")
            test_results["step2_wrong_password"] = True
        else:
            print(f"[-] 驗證失敗：錯誤密碼測試未通過。Alert 紀錄: {dialog_records}, Modal 可見性: {page.is_visible('#scheduleAdjustModal')}")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_wrong_password.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step2_wrong_password_closed.png"))

        # --- 4. 測試場景：輸入正確密碼並調整船期 (驗證 W12 排序與橘色 Badge) ---
        print("[*] 測試場景：輸入正確密碼並手動編輯未來船期...")
        page.click('h3:has-text("船期表")')
        page.wait_for_selector("#pwdModal", state="visible")
        
        # 輸入正確密碼
        page.fill("#modalPwdInput", TEST_PASSWORD)
        page.click("#pwdModal .btn-confirm")
        
        # 等待調整 Modal 開啟
        page.wait_for_selector("#scheduleAdjustModal", state="visible")
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(TEMP_DIR, "step3_schedule_adjust_modal.png"))
        
        # 清空目前表格中所有的預設列
        print("[*] 正在透過 JS 清空編輯表單以進行全新輸入...")
        page.evaluate("editScheduleList = []; renderAdjustTable();")
        page.wait_for_timeout(300)

        # 增加今日第一艘船 TEST-W12 (W12 碼頭)
        print("[*] 新增 TEST-W12 船期...")
        page.click('#scheduleAdjustModal button.add-row-btn')
        page.wait_for_timeout(300)
        rows = page.locator("#adjustTableBody tr")
        
        # 填寫 TEST-W12
        rows.nth(0).locator('input[placeholder="如 6/14"]').fill(today_md)
        rows.nth(0).locator('input[placeholder="如 6/14"]').blur()
        rows.nth(0).locator('select').nth(0).select_option("W12")
        rows.nth(0).locator('input[placeholder="船名"]').fill("TEST-W12")
        rows.nth(0).locator('input[placeholder="船名"]').blur()
        rows.nth(0).locator('select').nth(1).select_option("15")

        # 增加今日第二艘船 TEST-NORMAL (無碼頭)
        print("[*] 新增 TEST-NORMAL 船期...")
        page.click('#scheduleAdjustModal button.add-row-btn')
        page.wait_for_timeout(300)
        rows = page.locator("#adjustTableBody tr")
        
        # 填寫 TEST-NORMAL
        rows.nth(0).locator('input[placeholder="如 6/14"]').fill(today_md)
        rows.nth(0).locator('input[placeholder="如 6/14"]').blur()
        rows.nth(0).locator('select').nth(0).select_option("")
        rows.nth(0).locator('input[placeholder="船名"]').fill("TEST-NORMAL")
        rows.nth(0).locator('input[placeholder="船名"]').blur()
        rows.nth(0).locator('select').nth(1).select_option("12")

        # 儲存調整
        print("[*] 儲存手動調整中...")
        dialog_records.clear() # 清空對話框紀錄
        page.click('#scheduleAdjustModal button:has-text("儲存調整")')
        
        # 輪詢等待儲存成功 Alert 出現（最多等 12 秒）
        success_alert_found = False
        for _ in range(24):
            has_success_alert = any("儲存成功" in d["message"] for d in dialog_records if d["type"] == "alert")
            has_error_alert = any("儲存失敗" in d["message"] or "錯誤" in d["message"] or "連線錯誤" in d["message"] for d in dialog_records if d["type"] == "alert")
            if has_success_alert:
                success_alert_found = True
                break
            if has_error_alert:
                break
            page.wait_for_timeout(500)
            
        if success_alert_found:
            print("[+] 儲存成功 Alert 已攔截")
            test_results["step3_correct_password"] = True
        else:
            print(f"[-] 儲存失敗或無 Alert 響應。當前紀錄: {dialog_records}")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_save_failed.png"))
            browser.close()
            return

        # 驗證首頁船期表的排序與 Badge 渲染
        print("[*] 驗證首頁船期表是否套用 W12 優先排序規則與 Badge 顯示...")
        page.wait_for_selector("#scheduleBody tr", state="visible")
        
        first_row = page.locator("#scheduleBody tr").first
        second_row = page.locator("#scheduleBody tr").nth(1)
        
        first_ship = first_row.get_attribute("data-shipname")
        second_ship = second_row.get_attribute("data-shipname")
        
        # 檢查第一列是否為 TEST-W12，且包含 badge-w12 類別
        has_badge_w12 = first_row.locator("span.badge-w12").is_visible()
        
        print(f"[+] 船期表排序：首列 = {first_ship} (W12 Badge: {has_badge_w12}), 次列 = {second_ship}")
        
        if first_ship == "TEST-W12" and has_badge_w12 and second_ship == "TEST-NORMAL":
            print("[+] 驗證成功：W12 優先排序正確，且成功渲染橘色 W12 Badge！")
            test_results["step4_edit_schedule_sorting"] = True
        else:
            print("[-] 驗證失敗：船期排序或 Badge 渲染不符預期")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_sorting.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step4_schedule_rendered.png"))

        # --- 5. 測試場景：手動啟動監控 (對 TEST-W12 啟動監控) ---
        print("[*] 測試場景：手動啟動監控 (TEST-W12)...")
        # 點擊「齒輪/快進」手動設定按鈕
        page.click('.cpc-btn')
        page.wait_for_selector("#pwdModal", state="visible")
        page.fill("#modalPwdInput", TEST_PASSWORD)
        page.click("#pwdModal .btn-confirm")
        
        page.wait_for_selector("#manualModal", state="visible")
        page.wait_for_timeout(500)
        
        # 填寫手動監控設定
        page.fill("#shipName", "TEST-W12")
        page.fill("#limitSpeed", "15.0")
        page.select_option("#terminal", "W12")
        
        # 點擊開始監控
        page.click("#startBtn")
        page.wait_for_timeout(4000) # 等待 GAS 與 Firebase 處理完成
        
        # 🌟 為了確保能測到「等待進港」狀態，我們手動將 Firebase 中的 season_time 設為當天深夜 23:59
        print("[*] 模擬等待進港狀態：將 Firebase active_status 的 season_time 設為 23:59...")
        token = get_firebase_token()
        requests.patch(f"{DB_URL}test/active_status.json?access_token={token}", json={"season_time": "23:59"})
        page.wait_for_timeout(1500) # 等待網頁即時更新
        
        # 驗證呼吸燈是否顯示為 Waiting
        page.wait_for_selector("#dynamicBox", state="visible")
        box_class = page.locator("#dynamicBox").get_attribute("class")
        box_text = page.locator("#dynamicBox").text_content()
        print(f"[+] 呼吸燈啟動成功！類別: {box_class}, 內容: {box_text}")
        
        if "status-waiting" in box_class and "TEST-W12 等待進港" in box_text:
            print("[+] 驗證成功：手動監控順利啟動，呼吸燈顯示為「等待進港」狀態！")
            test_results["step5_start_monitoring"] = True
        else:
            print("[-] 驗證失敗：呼吸燈等待狀態不正確")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_monitor_start.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step5_monitoring_started.png"))

        # 這裡我們來模擬即時風速更新：把風速調低，且設定 season_time 為 00:00，讓呼吸燈轉為「綠色可進港」
        print("[*] 模擬風速變低：將 Firebase active_status 的 season_time 設為 00:00, current_wind 設為 10.0 (限速 15.0)...")
        requests.patch(f"{DB_URL}test/active_status.json?access_token={token}", json={"season_time": "00:00", "current_wind": 10.0})
        
        page.wait_for_timeout(1500) # 等待 Firebase 監聽觸發網頁更新
        box_class = page.locator("#dynamicBox").get_attribute("class")
        box_text = page.locator("#dynamicBox").text_content()
        print(f"[+] 呼吸燈即時更新：類別: {box_class}, 內容: {box_text}")
        
        if "status-safe" in box_class and "TEST-W12 可進港" in box_text:
            print("[+] 驗證成功：呼吸燈隨風速降低，立即綠燈呼吸且文字切換為「TEST-W12 可進港」！")
        else:
            print("[-] 驗證失敗：呼吸燈沒有正確切換至可進港綠燈")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_green_light.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step5_green_light.png"))

        # 這裡我們來模擬風速超標：把風速調高，讓呼吸燈轉為「紅色無法進港」
        print("[*] 模擬風速超標：將 Firebase active_status 的 current_wind 設為 16.0 (限速 15.0)...")
        requests.patch(f"{DB_URL}test/active_status.json?access_token={token}", json={"current_wind": 16.0})
        
        page.wait_for_timeout(1500) # 等待 Firebase 監聽觸發網頁更新
        box_class = page.locator("#dynamicBox").get_attribute("class")
        box_text = page.locator("#dynamicBox").text_content()
        print(f"[+] 呼吸燈即時更新：類別: {box_class}, 內容: {box_text}")
        
        if "status-warning" in box_class and "TEST-W12 無法進港" in box_text:
            print("[+] 驗證成功：呼吸燈隨風速超標，立即紅燈呼吸且文字切換為「TEST-W12 無法進港 (風速超標)」！")
        else:
            print("[-] 驗證失敗：呼吸燈沒有正確切換至無法進港紅燈")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_red_light.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step5_red_light.png"))

        # 將狀態還原成綠色可進港，以便後續進港 (POB) 測試
        print("[*] 將風速還原為 10.0，以便後續進港測試...")
        requests.patch(f"{DB_URL}test/active_status.json?access_token={token}", json={"current_wind": 10.0})
        page.wait_for_timeout(1000)

        # --- 6. 測試場景：同日多船自動接力 (模擬 LINE POB) ---
        print("[*] 測試場景：模擬 LINE POB 順利進港，驗證自動接力下一艘船...")
        dialog_records.clear()
        
        # 點擊「💬 模擬 LINE (POB)」按鈕
        page.click('button:has-text("💬 模擬 LINE (POB)")')
        # Playwright 的 dialog 監聽器會自動回答：TEST-W12 與 14:15 POB
        page.wait_for_timeout(5000) # 等待 LINE Webhook 處理，並等待自動接力邏輯寫入
        
        # 驗證 1：第一艘船 TEST-W12 進港訊息已寫入 POB 紀錄板，且為綠色字體 (#198754)
        page.wait_for_selector("#pobList", state="visible")
        pob_list_style = page.locator("#pobList div").first.get_attribute("style")
        pob_list_text = page.locator("#pobList").text_content()
        print(f"[+] POB 紀錄板：樣式: {pob_list_style}, 內容: {pob_list_text}")
        
        if "TEST-W12 已於 14:15 進港" in pob_list_text and ("#198754" in pob_list_style or "rgb(25, 135, 84)" in pob_list_style):
            print("[+] 驗證成功：第一艘船進港訊息正確顯示為綠色粗體！")
            test_results["step6_simulate_pob"] = True
        else:
            print("[-] 驗證失敗：第一艘船進港訊息顯示不正確")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_pob_record.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step6_first_ship_pob.png"))

        # 驗證 2：自動接力是否已無縫啟動第二艘船 TEST-NORMAL 的監控 (active_status 更新為 TEST-NORMAL)
        # 此時呼吸燈應該重開，且主角換成 TEST-NORMAL
        print("[*] 等待自動接力啟動 TEST-NORMAL 監控...")
        try:
            expect(page.locator("#dynamicBox")).to_contain_text("TEST-NORMAL", timeout=10000)
            box_text = page.locator("#dynamicBox").text_content()
            print(f"[+] 自動接力後的呼吸燈內容: {box_text}")
            print("[+] 驗證成功：自動接力引擎成功啟動今日下一順位船隻 [TEST-NORMAL]！")
            test_results["step7_auto_handoff"] = True
        except AssertionError as e:
            box_text = page.locator("#dynamicBox").text_content()
            print(f"[-] 驗證失敗：自動接力未成功，目前呼吸燈內容為: {box_text}")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_auto_handoff.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step7_second_ship_started.png"))

        # --- 7. 測試場景：結束監控原因歸檔 (對 TEST-NORMAL 手動結束監控並填寫無法進港原因) ---
        print("[*] 測試場景：對 TEST-NORMAL 手動結束監控，選擇「無法進港原因: 風速超標」...")
        page.click('.cpc-btn')
        page.wait_for_selector("#pwdModal", state="visible")
        page.fill("#modalPwdInput", TEST_PASSWORD)
        page.click("#pwdModal .btn-confirm")
        
        page.wait_for_selector("#manualModal", state="visible")
        page.wait_for_timeout(500)
        
        # 此時因為是在監控中，應該會顯示「結束監控」表單 (#stopMonitorGroup 顯示，#startBtn 隱藏，#resetBtn 顯示)
        is_stop_group_visible = page.locator("#stopMonitorGroup").is_visible()
        print(f"[*] 結束監控區塊是否可見: {is_stop_group_visible}")
        
        if not is_stop_group_visible:
            print("[-] 驗證失敗：結束監控表單未正確顯示")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_stop_group_hidden.png"))
            browser.close()
            return
            
        # 選擇無法進港原因：風速超標
        page.select_option("#noEntryReason", "風速超標")
        
        # 點擊結束監控
        dialog_records.clear()
        page.click("#resetBtn")
        # 等待呼吸燈隱藏 (stopped 狀態)
        page.wait_for_selector("#dynamicBox", state="hidden")
        is_box_hidden = not page.locator("#dynamicBox").is_visible()
        # 驗證 2：POB 紀錄板新增了 TEST-NORMAL 無法進港的紅色粗體訊息
        pob_list_text = page.locator("#pobList").text_content()
        normal_pob_div = page.locator("#pobList div:has-text('TEST-NORMAL')")
        normal_pob_style = normal_pob_div.get_attribute("style")
        if is_box_hidden and "TEST-NORMAL無法進港，原因:風速超標" in pob_list_text and ("#dc3545" in normal_pob_style or "rgb(220, 53, 69)" in normal_pob_style):
            print("[+] 驗證成功：手動結束監控成功，呼吸燈秒速隱藏，且無法進港訊息渲染為粗體紅色！")
            test_results["step8_manual_cannot_entry"] = True
        else:
            print("[-] 驗證失敗：手動結束監控後狀態或顏色不正確")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_cannot_entry.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step8_second_ship_cannot_enter.png"))

        # --- 8.5 測試場景：驗證無法進港船出現在調整頁面第一列，且日期為空 ---
        print("[*] 測試場景：驗證無法進港船出現在調整頁面第一列且日期為空，隨後填入日期並儲存...")
        # 🌟 暫停 6 秒，確保後台 GAS 寫入 UNFINISHED_SHIP 並完成 Firebase 船期表同步
        page.wait_for_timeout(6000)
        # 重新整理網頁以確保拉取到最新資料
        page.reload()
        page.wait_for_timeout(2000)
        # 點擊船期表標題以開啟調整視窗
        page.click('h3:has-text("船期表")')
        page.wait_for_selector("#pwdModal", state="visible")
        page.fill("#modalPwdInput", TEST_PASSWORD)
        page.click("#pwdModal .btn-confirm")
        
        page.wait_for_selector("#scheduleAdjustModal", state="visible")
        page.wait_for_timeout(500)
        
        # 獲取調整頁面第一列的船名與日期
        first_row = page.locator("#adjustTableBody tr").nth(0)
        first_ship_name = first_row.locator('input[placeholder="船名"]').input_value()
        first_ship_date = first_row.locator('input[placeholder="如 6/14"]').input_value()
        
        print(f"[+] 調整頁面第一列：船名: {first_ship_name}, 日期: {first_ship_date}")
        
        if first_ship_name == "TEST-NORMAL" and first_ship_date == "":
            print("[+] 驗證成功：無法進港船已自動出現在調整列表第一列且日期為空白！")
        else:
            print("[-] 驗證失敗：調整列表第一列的船名或日期不正確")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_reschedule_list.png"))
            browser.close()
            return
            
        # 獲取明天日期 (M/D 格式，如 6/16)
        tomorrow = datetime.now() + timedelta(days=1)
        tomorrow_md = f"{tomorrow.month}/{tomorrow.day}"
        print(f"[*] 輸入改期新日期至明天: {tomorrow_md}")
        first_row.locator('input[placeholder="如 6/14"]').fill(tomorrow_md)
        page.wait_for_timeout(200)
        
        # 點擊「儲存調整」
        page.click('button:has-text("儲存調整")')
        page.wait_for_selector("#scheduleAdjustModal", state="hidden")
        
        # 驗證主畫面船期表重新顯示該船，且日期已變更為明天
        page.wait_for_selector("#scheduleBody tr:has-text('TEST-NORMAL')")
        print("[+] 驗證成功：手動填寫日期並儲存後，主畫面船期表已重新顯示該船！")
        page.screenshot(path=os.path.join(TEMP_DIR, "step8_5_rescheduled_ship_saved.png"))

        # --- 8. 測試場景：23:00 歸檔與重置 (測試環境手動歸檔與 J, K 欄檢查) ---
        print("[*] 測試場景：執行手動歸檔重置...")
        # 點擊「📦 手動歸檔與重置」按鈕
        page.click('button:has-text("📦 手動歸檔與重置")')
        
        print("[*] 正在歸檔與清理 Firebase 狀態...")
        page.wait_for_selector("#pobList", state="hidden")
        
        # 驗證歸檔後，網頁狀態全部重置 (呼吸燈依然是 none，POB 紀錄板清空隱藏)
        is_pob_list_hidden = not page.locator("#pobList").is_visible()
        print(f"[+] 歸檔清理後 POB 紀錄板是否隱藏: {is_pob_list_hidden}")
        
        if is_pob_list_hidden:
            print("[+] 驗證成功：Firebase 今日資料已完全歸檔並清理重置！")
            test_results["step9_archive_test"] = True
        else:
            print("[-] 驗證失敗：歸檔後 Firebase 資料未清除")
            page.screenshot(path=os.path.join(TEMP_DIR, "error_archive_clear.png"))
            browser.close()
            return
            
        page.screenshot(path=os.path.join(TEMP_DIR, "step9_archived.png"))
        
        # --- 9.5 驗證智慧延遲繼承與條件歸檔機制 (Firebase 資料與試算表雙重斷言) ---
        print("[*] 驗證智慧延遲繼承與條件歸檔機制 (Firebase 資料與試算表雙重斷言)...")
        today_str = datetime.now().strftime("%Y-%m-%d")
        tomorrow_str = tomorrow.strftime("%Y-%m-%d")
        
        token = get_firebase_token()
        
        # 1. 驗證今日 (today_str) 的監控卡是否已清空
        today_records_url = f"{DB_URL}test/daily_records/{today_str}.json?access_token={token}"
        res_today = requests.get(today_records_url, timeout=10)
        today_data = res_today.json()
        print(f"[*] 今日 {today_str} 節點資料: {today_data}")
        
        # 2. 驗證明日 (tomorrow_str) 是否成功建立了繼承過去 of TEST-NORMAL 監控卡
        tomorrow_records_url = f"{DB_URL}test/daily_records/{tomorrow_str}.json?access_token={token}"
        res_tomorrow = requests.get(tomorrow_records_url, timeout=10)
        tomorrow_data = res_tomorrow.json()
        print(f"[*] 明日 {tomorrow_str} 節點資料: {tomorrow_data}")
        
        is_inherited_success = False
        if today_data is None:
            print("[+] 斷言 1 成功：今日監控卡片節點已被安全清空！")
        else:
            print("[-] 斷言 1 失敗：今日監控節點依然有殘留資料！")
            
        if tomorrow_data and isinstance(tomorrow_data, dict):
            card_keys = list(tomorrow_data.keys())
            target_key = next((k for k in card_keys if "TEST-NORMAL" in k), None)
            if target_key:
                card_info = tomorrow_data[target_key]
                config = card_info.get("config", {})
                original_date = config.get("original_date")
                delay_reasons = config.get("delay_reasons", [])
                
                print(f"[+] 找到繼承卡片: {target_key}, config: {config}")
                
                # 驗證 original_date 是否為今天日期，且延遲原因包含 "風速超標"
                if original_date == today_str and any("風速超標" in r for r in delay_reasons):
                    print("[+] 斷言 2 成功：明日卡片成功繼承原定日期與延遲原因歷程！")
                    is_inherited_success = True
                else:
                    print(f"[-] 斷言 2 失敗：繼承內容不符。原定日期: {original_date}, 延遲紀錄: {delay_reasons}")
            else:
                print("[-] 斷言 2 失敗：在明日節點中找不到 TEST-NORMAL 的卡片！")
        else:
            print("[-] 斷言 2 失敗：明日監控節點為空！")

        # 3. 透過 GAS API 驗證「今天歸檔時，TEST-NORMAL 是否未被歸檔至試算表」
        # 因為它被改期了，最後一列歸檔資料應該只有今天已進港的 TEST-W12
        sheet_url = f"{GAS_API_URL}?action=get_last_sheet_row&pwd={TEST_PASSWORD}"
        res_sheet = requests.get(sheet_url, timeout=15)
        sheet_res_json = res_sheet.json()
        print(f"[*] 今日歸檔後試算表最後一列資料: {sheet_res_json}")
        
        is_today_exclude_success = False
        if sheet_res_json.get("status") == "success":
            row_data = sheet_res_json.get("row", [])
            # 欄 2 (B) 是船名
            if len(row_data) >= 2 and row_data[1] == "TEST-W12":
                print("[+] 斷言 3 成功：TEST-NORMAL 在今日歸檔時成功被排除，未寫入試算表！")
                is_today_exclude_success = True
            else:
                print(f"[-] 斷言 3 失敗：今日最後一列船名為 {row_data[1] if len(row_data) >= 2 else '無'}, 預期為 TEST-W12")
        else:
            print(f"[-] 斷言 3 失敗：讀取試算表失敗: {sheet_res_json.get('msg')}")

        # 4. 模擬明天 TEST-NORMAL 順利 POB 進港歸檔，驗證延遲天數與原因備註寫入 I 欄
        print("[*] 模擬明天 TEST-NORMAL 順利 POB 進港...")
        # 4.1 直接向 Firebase 明天路徑寫入 POB 資訊
        tomorrow_card_key = f"{tomorrow_str}_TEST-NORMAL"
        pob_path_url = f"{DB_URL}test/daily_records/{tomorrow_str}/{tomorrow_card_key}/pob_info.json?access_token={token}"
        pob_payload = {
            "pob_time": "14:15",
            "pob_wind_speed": 5.2,
            "formatted_msg": "TEST-NORMAL 已於 14:15 進港"
        }
        requests.patch(pob_path_url, json=pob_payload, timeout=10)
        print("[+] 已成功模擬明日 TEST-NORMAL 的 POB 資訊寫入 Firebase")
        
        # 4.2 呼叫明天的歸檔 (sim_date = 明日日期)
        print(f"[*] 執行明日 {tomorrow_str} 的模擬歸檔...")
        tomorrow_archive_url = f"{GAS_API_URL}?action=archive_test&pwd={TEST_PASSWORD}&sim_date={tomorrow_str}&fb_token={token}"
        requests.get(tomorrow_archive_url, timeout=15)
        
        # 4.3 獲取最後一列試算表數據，驗證歸檔結果與 I 欄備註延遲寫入
        res_sheet_tomorrow = requests.get(sheet_url, timeout=15)
        sheet_res_tomorrow_json = res_sheet_tomorrow.json()
        print(f"[*] 明日歸檔後試算表最後一列資料: {sheet_res_tomorrow_json}")
        
        is_delay_note_success = False
        if sheet_res_tomorrow_json.get("status") == "success":
            row_data = sheet_res_tomorrow_json.get("row", [])
            # 欄 2 (B): 船名 -> TEST-NORMAL
            # 欄 4 (D): POB時間 -> 14:15
            # 欄 9 (I): 備註 -> 原定:MM-DD 延遲:1天 (I 欄索引為 8，0-indexed)
            if len(row_data) >= 9:
                ship_name_final = row_data[1]
                pob_time_final = row_data[3]
                delay_note_final = row_data[8]
                
                print(f"[+] 明日歸檔欄位內容：船名: {ship_name_final}, POB時間: {pob_time_final}, 備註欄 (I 欄): {delay_note_final}")
                
                # 計算期望的備註文字，例如 "原定:06-15 延遲:1天"
                expected_note = f"原定:{today_str[5:]} 延遲:1天"
                if ship_name_final == "TEST-NORMAL" and pob_time_final == "14:15" and delay_note_final == expected_note:
                    print(f"[+] 斷言 4 成功：試算表歸檔正確！船名、POB時間相符，且備註欄成功寫入：{delay_note_final}")
                    is_delay_note_success = True
                else:
                    print(f"[-] 斷言 4 失敗：歸檔欄位不符，預期船名: TEST-NORMAL, POB: 14:15, 備註: {expected_note}")
            else:
                print(f"[-] 斷言 4 失敗：明日最後一列欄位長度不足 9，目前長度: {len(row_data)}")
        else:
            print(f"[-] 斷言 4 失敗：讀取試算表失敗: {sheet_res_tomorrow_json.get('msg')}")

        # 5. 彙整檢驗結果
        if today_data is None and is_inherited_success and is_today_exclude_success and is_delay_note_success:
            print("[+] 智慧延遲繼承與條件歸檔機制 (Firebase 與試算表雙重斷言) 驗證 100% 成功！")
            test_results["step10_delay_inheritance"] = True
        else:
            print("[-] 智慧延遲繼承與條件歸檔機制驗證未通過！")
            browser.close()
            return

        # 6. 清理測試環境，重置回真實的 API 船期，方便使用者後續操作
        print("[*] 正在將測試環境重置回真實 API 船期...")
        reset_url = f"{GAS_API_URL}?action=update_schedule&reset=true&pwd={TEST_PASSWORD}&fb_token={token}"
        try:
            requests.get(reset_url, timeout=15)
            print("[+] 成功將測試環境重置回 API 預設船期！")
        except Exception as e:
            print(f"[-] 清理重置連線失敗: {e}")

        # 關閉瀏覽器
        print("[*] 關閉瀏覽器，自動測試順利完成！")
        browser.close()

if __name__ == "__main__":
    print("=================== 啟動 LNG 監控系統大改版自動測試 ===================")
    start_time = time.time()
    run_tests()
    end_time = time.time()
    
    # 輸出總結報告
    print("\n=================== 自動測試報告總結 ===================")
    print(f"[*] 總執行時間: {end_time - start_time:.2f} 秒")
    for step, success in test_results.items():
        status_str = "✅ 成功" if success else "❌ 失敗"
        print(f" - {step:<30}: {status_str}")
    print("========================================================\n")
