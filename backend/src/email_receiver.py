import imaplib
import email
import os
import re
from datetime import datetime
from src.config import load_config

def download_forecast_attachment(target_date=None, save_dir=None):
    """
    Downloads the .doc wind forecast attachment for target_date (format MMDD, e.g. '0530').
    If target_date is None, today's MMDD in Asia/Taipei timezone is used.
    """
    config = load_config()
    imap_settings = config.get("Gmail_IMAP_Settings", {})
    
    gmail_account = imap_settings.get("GmailAccount")
    gmail_password = imap_settings.get("GmailAppPassword")
    target_sender = imap_settings.get("TargetSender", "weather.center@msa.hinet.net")
    
    if not save_dir:
        # Save to project root
        from src.config import BASE_DIR
        save_dir = BASE_DIR
        
    if not target_date:
        # Get current date in MMDD format (Taiwan timezone is UTC+8)
        # We can calculate CST time offset
        import time
        # Standard timezone offset check
        # Check if we should override date processing for the incoming email
        # Determine the target date to match based on local CST time
        from datetime import timezone, timedelta
        cst_time = datetime.now(timezone(timedelta(hours=8)))
        target_date = cst_time.strftime("%m%d")
        
    subject_pattern = f"{target_date}"
    print(f"Targeting date MMDD: {target_date} (Subject containing: {subject_pattern})")
    
    # Try searching for a local file first as a cache/fallback
    local_filename = f"{target_date}中油.doc"
    # Also support other variations in workspace and 空軍原始檔
    from src.config import BASE_DIR
    search_dirs = [save_dir, os.path.join(BASE_DIR, "空軍原始檔")]
    for sdir in search_dirs:
        if os.path.exists(sdir):
            for filename in os.listdir(sdir):
                if target_date in filename and filename.endswith(".doc"):
                    print(f"Found existing local file matching date: {filename} in {sdir}")
                    return os.path.join(sdir, filename)

    print("Connecting to Gmail IMAP...")
    mail = None
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
        mail.login(gmail_account, gmail_password)
        mail.select("inbox")
        
        # Search for messages from target_sender
        # We search with FROM and a broad search, then filter subjects in python for flexibility
        status, messages = mail.search(None, f'(FROM "{target_sender}")')
        if status != "OK":
            print("Failed to search emails.")
            raise Exception("IMAP search failed")
            
        message_ids = messages[0].split()
        # Scan only the newest 15 emails (weather forecast is always sent recently)
        scan_list = list(reversed(message_ids))[:15]
        print(f"Found {len(message_ids)} emails from {target_sender}. Fast-scanning top {len(scan_list)} recent emails for subject '{subject_pattern}'...")
        
        for msg_id in scan_list:
            # 1. Fetch only Subject header (ultra fast, takes <0.1s without downloading attachments)
            status, header_data = mail.fetch(msg_id, "(BODY.PEEK[HEADER.FIELDS (SUBJECT)])")
            if status != "OK" or not header_data:
                continue
                
            raw_header = header_data[0][1]
            hdr_msg = email.message_from_bytes(raw_header)
            raw_subj = hdr_msg.get("Subject", "")
            
            # Decode subject cleanly
            decoded_fragments = email.header.decode_header(raw_subj)
            parts = []
            for frag, enc in decoded_fragments:
                if isinstance(frag, bytes):
                    parts.append(frag.decode(enc or "utf-8", errors="ignore"))
                else:
                    parts.append(str(frag))
            subject = "".join(parts)
            
            # Check if subject matches (contains the MMDD date)
            clean_subject = re.sub(r"\s+", "", subject)
            if target_date in clean_subject:
                print(f"Match found in header! Subject: {subject}. Fetching full email...")
                
                # 2. Only fetch full RFC822 for the matched email
                status, msg_data = mail.fetch(msg_id, "(RFC822)")
                if status != "OK":
                    continue
                raw_email = msg_data[0][1]
                msg = email.message_from_bytes(raw_email)
                
                # Extract attachments
                for part in msg.walk():
                    if part.get_content_maintype() == "multipart":
                        continue
                    if part.get("Content-Disposition") is None:
                        continue
                        
                    filename = part.get_filename()
                    if filename:
                        # Decode filename
                        fn_frags = email.header.decode_header(filename)
                        fn_parts = []
                        for frag, enc in fn_frags:
                            if isinstance(frag, bytes):
                                fn_parts.append(frag.decode(enc or "utf-8", errors="ignore"))
                            else:
                                fn_parts.append(str(frag))
                        decoded_filename = "".join(fn_parts)
                        
                        if decoded_filename.endswith(".doc") or decoded_filename.endswith(".docx"):
                            # Force name to be target_date + 中油.doc
                            out_filename = f"{target_date}中油.doc"
                            filepath = os.path.join(save_dir, out_filename)
                            with open(filepath, "wb") as f:
                                f.write(part.get_payload(decode=True))
                            print(f"Downloaded attachment saved to: {filepath}")
                            return filepath
        
        print(f"No email matching subject '{subject_pattern}' found in top {len(scan_list)} recent emails.")
        
    except Exception as e:
        print(f"IMAP receiving error: {e}")
    finally:
        if mail:
            try:
                mail.close()
                mail.logout()
            except:
                pass
                
    # No fallback allowed
    print("Email receiver failed or no match.")
    raise FileNotFoundError("No wind forecast .doc file found for today via Gmail.")
