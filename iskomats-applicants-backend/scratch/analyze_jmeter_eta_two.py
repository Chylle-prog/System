import csv
from collections import defaultdict

stats = defaultdict(lambda: {'total': 0, 'success': 0, 'times': [], 'success_times': []})

with open('c:/Users/Chyle/OneDrive/Desktop/System/jmeter_results_eta_two.jtl', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for r in reader:
        lbl = r['label']
        elapsed = int(r['elapsed'])
        is_succ = r['success'] == 'true'
        stats[lbl]['total'] += 1
        stats[lbl]['times'].append(elapsed)
        if is_succ:
            stats[lbl]['success'] += 1
            stats[lbl]['success_times'].append(elapsed)

print(f"{'Endpoint':<35} | {'Total':<6} | {'Success':<7} | {'Err %':<6} | {'Avg All(ms)':<11} | {'Avg Succ(ms)':<12} | {'Max(ms)':<8}")
print('-' * 95)
for k, v in stats.items():
    tot = v['total']
    succ = v['success']
    err_pct = (1 - succ / tot) * 100
    avg_all = sum(v['times']) / tot if tot else 0
    avg_succ = sum(v['success_times']) / len(v['success_times']) if v['success_times'] else 0
    max_t = max(v['times']) if v['times'] else 0
    print(f"{k:<35} | {tot:<6} | {succ:<7} | {err_pct:<6.1f} | {avg_all:<11.1f} | {avg_succ:<12.1f} | {max_t:<8}")
