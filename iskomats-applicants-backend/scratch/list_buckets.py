import os
from supabase import create_client

def list_buckets():
    url = "https://cgslnbnqzxevrzbjdyru.supabase.co"
    key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnc2xuYm5xenhldnJ6YmpkeXJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3YzYzNTQ4OSwiZXhwIjoyMDg5MjExNDg5fQ.yR_oapxY_CUppDsoCX6vVmF3cdJDpAJisHBGrquU6_c"
    
    supabase = create_client(url, key)
    try:
        buckets = supabase.storage.list_buckets()
        print("Buckets found:")
        for b in buckets:
            print(f"- {b.name} (Public: {b.public})")
    except Exception as e:
        print(f"Error listing buckets: {e}")

if __name__ == "__main__":
    list_buckets()
