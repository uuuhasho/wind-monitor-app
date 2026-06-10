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
        
    subject_pattern = f"中油{target_date}"
    print(f"Targeting date MMDD: {target_date} (Subject: {subject_pattern})")
    
    # Try searching for a local file first as a cache/fallback
    local_filename = f"{target_date}中油.doc"
    # Also support other variations in workspace
    for filename in os.listdir(save_dir):
        if target_date in filename and filename.endswith(".doc"):
            print(f"Found existing local file matching date: {filename}")
            return os.path.join(save_dir, filename)

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
        print(f"Found {len(message_ids)} emails from {target_sender}. Scanning for subject '{subject_pattern}'...")
        
        # Scan from newest to oldest
        for msg_id in reversed(message_ids):
            status, msg_data = mail.fetch(msg_id, "(RFC822)")
            if status != "OK":
                continue
                
            raw_email = msg_data[0][1]
            msg = email.message_from_bytes(raw_email)
            
            # Decode subject
            subject, encoding = email.header.decode_header(msg["Subject"])[0]
            if isinstance(subject, bytes):
                subject = subject.decode(encoding or "utf-8", errors="ignore")
            
            # Check if subject matches (e.g. contains "中油" and the MMDD date)
            # Match variations like "中油0530", "中油 0530", "中油-0530"
            clean_subject = re.sub(r"\s+", "", subject)
            if "中油" in clean_subject and target_date in clean_subject:
                print(f"Match found! Subject: {subject}")
                
                # Extract attachments
                for part in msg.walk():
                    if part.get_content_maintype() == "multipart":
                        continue
                    if part.get("Content-Disposition") is None:
                        continue
                        
                    filename = part.get_filename()
                    if filename:
                        # Decode filename
                        decoded_filename, encoding = email.header.decode_header(filename)[0]
                        if isinstance(decoded_filename, bytes):
                            decoded_filename = decoded_filename.decode(encoding or "utf-8", errors="ignore")
                        
                        if decoded_filename.endswith(".doc") or decoded_filename.endswith(".docx"):
                            # Force name to be target_date + 中油.doc
                            out_filename = f"{target_date}中油.doc"
                            filepath = os.path.join(save_dir, out_filename)
                            with open(filepath, "wb") as f:
                                f.write(part.get_payload(decode=True))
                            print(f"Downloaded attachment saved to: {filepath}")
                            return filepath
        
        print(f"No email matching subject '{subject_pattern}' found.")
        
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
