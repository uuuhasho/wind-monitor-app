import os
import shutil
import subprocess
import sys

def deploy():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    source_dir = os.path.dirname(script_dir)
    clean_dir = "C:\\Users\\hilla\\Desktop\\newlngship_clean"
    
    print(f"[*] Creating clean workspace at {clean_dir}...")
    if os.path.exists(clean_dir):
        try:
            shutil.rmtree(clean_dir)
        except Exception as e:
            print(f"Warning: could not clean directory: {e}")
    os.makedirs(clean_dir, exist_ok=True)
    
    print("[*] Copying backend files from current project root...")
    src_prefix = script_dir
    
    files_to_copy = ["app.py", "main.py", "requirements.txt", "Dockerfile"]
    for file_name in files_to_copy:
        src_path = os.path.join(src_prefix, file_name)
        dst_path = os.path.join(clean_dir, file_name)
        if os.path.exists(src_path):
            shutil.copy2(src_path, dst_path)
            print(f"  Copied {file_name}")
        else:
            print(f"  Warning: {file_name} not found in {src_prefix}")
            
    # Copy src dir
    src_dir = os.path.join(src_prefix, "src")
    dst_dir = os.path.join(clean_dir, "src")
    if os.path.exists(src_dir):
        shutil.copytree(src_dir, dst_dir, dirs_exist_ok=True)
        print("  Copied src directory")
    else:
        print("  Warning: src directory not found")
        
    # Generate .gcloudignore
    print("[*] Generating .gcloudignore...")
    gcloudignore_content = "config.json\nservice_account.json\n.env\ntemp/\n__pycache__/\n"
    with open(os.path.join(clean_dir, ".gcloudignore"), "w", encoding="ascii") as f:
        f.write(gcloudignore_content)
        
    print("[*] Triggering gcloud run deploy for TEST (forecast-api-test)...")
    # Run gcloud deploy in clean_dir
    cmd = 'gcloud run deploy forecast-api-test --source . --region asia-southeast1 --allow-unauthenticated --execution-environment gen2 --update-env-vars="FIREBASE_RTDB_PREFIX=/test"'
    
    # We use shell=True to execute gcloud on Windows
    result = subprocess.run(cmd, cwd=clean_dir, shell=True)
    if result.returncode != 0:
        print("[!] Deployment failed.")
        sys.exit(1)
        
    print("[*] Triggering Artifact Registry auto-cleanup...")
    # Run cleanup using absolute path to avoid encoding bugs
    cleanup_script = os.path.join(src_prefix, "cleanup_registry.py")
    if os.path.exists(cleanup_script):
        subprocess.run(f'python "{cleanup_script}"', shell=True)
    else:
        print("Warning: cleanup_registry.py not found")
    
    print("[*] Deployment finished successfully.")

if __name__ == "__main__":
    deploy()
