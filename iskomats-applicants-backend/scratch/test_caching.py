import sys, os, time
sys.path.insert(0, os.path.abspath('.'))
from app import app

client = app.test_client()

print("Testing /api/student/scholarships/all under simulated concurrent requests...")

t0 = time.time()
res1 = client.get('/api/student/scholarships/all')
t1 = time.time()
print(f"Request 1 (DB Miss): Status {res1.status_code}, Time: {(t1 - t0)*1000:.2f}ms, X-Cache-Status: {res1.headers.get('X-Cache-Status')}")

t0 = time.time()
for i in range(100):
    res = client.get('/api/student/scholarships/all')
t1 = time.time()
print(f"Requests 2-101 (100 Cache Hits): Total Time: {(t1 - t0)*1000:.2f}ms (Avg {(t1 - t0)*10:.2f}ms/req), X-Cache-Status: {res.headers.get('X-Cache-Status')}")

t0 = time.time()
res_ann1 = client.get('/api/student/announcements')
t1 = time.time()
print(f"\nRequest 1 Announcements (DB Miss): Status {res_ann1.status_code}, Time: {(t1 - t0)*1000:.2f}ms, X-Cache-Status: {res_ann1.headers.get('X-Cache-Status')}")

t0 = time.time()
for i in range(100):
    res_ann = client.get('/api/student/announcements')
t1 = time.time()
print(f"Requests 2-101 Announcements (100 Cache Hits): Total Time: {(t1 - t0)*1000:.2f}ms (Avg {(t1 - t0)*10:.2f}ms/req), X-Cache-Status: {res_ann.headers.get('X-Cache-Status')}")
