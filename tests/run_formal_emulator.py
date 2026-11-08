"""Run the formal namespace rehearsal against a disposable local RTDB emulator."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JAVA = ROOT / "runtime" / "portable-java" / "jdk-21.0.12.1+1"


def main():
    firebase = shutil.which("firebase.cmd") or shutil.which("firebase")
    if not firebase:
        raise RuntimeError("Firebase CLI is required.")
    java = Path(os.environ.get("JAVA_HOME") or JAVA)
    if not (java / "bin" / ("java.exe" if os.name == "nt" else "java")).is_file():
        raise RuntimeError("Set JAVA_HOME to a valid JDK before running the emulator.")
    env = os.environ.copy()
    env["JAVA_HOME"] = str(java)
    env["PATH"] = str(java / "bin") + os.pathsep + env["PATH"]
    env.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        (temp / "database.rules.json").write_text(json.dumps({"rules": {
            ".read": False, ".write": False,
            "test": {".read": True, ".write": False},
            "formal": {".read": True, ".write": False},
            **{name: {".read": True, ".write": False} for name in (
                "active_status", "daily_records", "schedule_list", "pilot_schedule",
            )},
        }}), encoding="utf-8")
        (temp / "firebase.json").write_text(json.dumps({
            "database": {"rules": "database.rules.json"},
            "emulators": {"database": {"host": "127.0.0.1", "port": 19090}, "ui": {"enabled": False}},
        }), encoding="utf-8")
        command = subprocess.list2cmdline([sys.executable, "-B", str(ROOT / "tests" / "formal_emulator_cases.py")])
        subprocess.run([
            firebase, "emulators:exec", "--only", "database", "--project", "demo-formal-rtdb",
            "--config", str(temp / "firebase.json"), command,
        ], cwd=temp, env=env, check=True)


if __name__ == "__main__":
    main()
