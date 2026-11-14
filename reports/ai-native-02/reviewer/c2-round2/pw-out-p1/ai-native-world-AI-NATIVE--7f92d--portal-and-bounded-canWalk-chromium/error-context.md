# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> F-01/F-02: perception radius, occlusion, unexplored rooms, boss/portal and bounded canWalk
- Location: tests\ai-native-world.spec.ts:950:3

# Error details

```
Error: page.evaluate: Error: dev/test only
    at Ae.assertDevTest (http://localhost:5359/assets/main-1ThMxyvP.js:1:90357)
    at Ae.clearEnemiesForTest (http://localhost:5359/assets/main-1ThMxyvP.js:1:90601)
    at eval (eval at evaluate (:370:30), <anonymous>:112:9)
    at UtilityScript.evaluate (<anonymous>:372:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
```