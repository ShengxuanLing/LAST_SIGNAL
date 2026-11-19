import json, re
base = r'D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\logs'
data = json.load(open(base + r'\p1-list.json', encoding='utf-8'))
all_tests = []
def walk(suites):
    for s in suites:
        for sp in s.get('specs', []):
            for t in sp.get('tests', []):
                all_tests.append((sp.get('file', '').replace(chr(92), '/'), sp.get('line'), s.get('title', ''), sp.get('title', '')))
        walk(s.get('suites', []))
walk(data.get('suites', []))
print('total listed:', len(all_tests))
log = open(base + r'\p1-gate-5-playwright-full.log', encoding='utf-8', errors='ignore').read()
executed = set()
for m in re.finditer(r'^\[(\d+)/125\] \[chromium\] [^ ]+ (tests[^:]+):\d+:\d+ [^ ]+ (.*)$', log, re.M):
    executed.add((m.group(2).replace(chr(92), '/'), m.group(3).strip()))
print('executed:', len(executed))
missing = [t for t in all_tests if (t[0], t[3]) not in executed]
for t in missing:
    print('DID-NOT-RUN:', t[0], 'line', t[1], '|', t[2], '>', t[3])
