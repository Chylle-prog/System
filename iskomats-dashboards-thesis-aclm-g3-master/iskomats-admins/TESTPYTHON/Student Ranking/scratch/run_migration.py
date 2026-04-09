import os
import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from blueprints.student_api import ensure_verification_columns

if __name__ == "__main__":
    print("Running migration...")
    ensure_verification_columns()
    print("Migration finished.")
