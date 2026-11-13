# ART-02 璇佹嵁鐩綍

鍏ㄩ儴鎴浘鐢?`npx playwright test -c playwright.art02.config.ts`锛坄scripts/art02/capture.spec.ts`锛夊鏈湴 dev server 鐨勭湡瀹炶繍琛岀敾闈㈡埅鍙栥€傛瘡涓€甯ч兘鐢?*鐪熷疄閿洏杈撳叆椹卞姩鐪熷疄 `SliceModel`**锛屾病鏈夐鍒跺姩鐢汇€?
## Demo A 鈥?鐜鍗囩骇锛堝悓涓€鐘舵€併€佸悓涓€鐩告満銆佸悓涓€ 1280脳720锛?
`?vq=off` = 鍘熸覆鏌撳櫒锛堟敼閫犲墠锛夛紝`?vq=high` = ART-02锛堟敼閫犲悗锛夈€備袱寮犲浘閮藉湪 Esc 鏆傚仠鍚庢埅鍙栥€?
| 鍦烘櫙 | 鏀归€犲墠 | 鏀归€犲悗 |
|---|---|---|
| R1 瑙傛祴瀹為獙瀹?| `demoA-lab-before.png` | `demoA-lab-after.png` |
| R2 澶辩ǔ璧板粖 | `demoA-corridor-before.png` | `demoA-corridor-after.png` |

## Demo B 鈥?Signal 瑙嗚鍙嶉锛堝疄闄呮父鎴忕姸鎬侀┍鍔級

| # | 鏂囦欢 | 鏉冨▉鐘舵€?|
|---|---|---|
| 01 | `demoB-01-scan-wave.png` | Scan 浼犳挱涓紙12 鏍艰瀵熻寖鍥达級 |
| 02 | `demoB-02-scan-revealed-link.png` | 鎻ず锛氬皝閿佽浇娉?鈫?闂ㄦ帴鏀跺櫒锛堢孩鑹叉祦鍔?= 鏁屽鎺у埗锛?|
| 03 | `demoB-03-jam-door-open.png` | Jam 闂ㄦ帴鏀跺櫒锛氬厜鏉熴€佸共鎵般€侀棬 `JAMMED_OPEN` |
| 04 | `demoB-04-corridor-scan-relay-links.png` | 璧板粖鎵弿锛氫腑缁у櫒 鈫?妗ユ壙閲?/ 瀹堝崼鎰熺煡锛堜腑缁у櫒鍏抽棴 = 铏氱嚎锛?|
| 05 | `demoB-05-guard-jammed.png` | Jam 瀹堝崼锛氬畧鍗摼璺柇寮€ + 鍓╀綑鏃堕暱寮?|
| 06 | `demoB-06-bridge-transitioning.png` | Relay 寮€鍚?鈫?妗?`TRANSITIONING`锛堢嚎妗嗙粍瑁咃級 |
| 07 | `demoB-07-bridge-stable.png` | 妗?`STABLE`锛堝喎钃濆杞ㄨ剦鍐诧級 |
| 08 | `demoB-08-bridge-unstable.png` | Relay 鍏抽棴 鈫?妗?`UNSTABLE`锛堢惀鐝€銆佹畫褰便€佽绾癸級 |
| 09 | `demoB-09-bridge-recovered.png` | Relay 鍐嶅紑鍚?鈫?鎭㈠ `STABLE` |
| 10 | `demoB-10-guard-watching.png` | 瀹堝崼 `WATCHING`锛堢孩鐏€佹寚鍚戠帺瀹讹級 |
| 11 | `demoB-11-guard-hit.png` | 灏勫嚮鍛戒腑瀹堝崼锛堥棯鍏夈€佺伀鑺憋級 |

`demoB-console-errors.json`锛欴emo B 鏈熼棿娴忚鍣ㄦ帶鍒跺彴閿欒锛堝簲涓?`[]`锛夈€?
## 鍒嗚鲸鐜囦笌妗ｄ綅

- `res-1920x1080.png`銆乣res-1366x768.png`銆乣res-1280x720.png`銆乣res-1024x768.png`銆乣res-800x600.png`
- `tier-low.png`銆乣tier-medium.png`銆乣tier-high.png`
- `perf.json`锛?920脳1080 涓嬪悇妗ｄ綅 3 绉掑抚鏃堕棿閲囨牱锛堟棤澶?Chromium锛岀浉瀵规瘮杈冿紝闈炵‖浠剁粨璁猴級

## 娴嬭瘯鏃ュ織锛坄logs/`锛?
- `baseline-*.txt`锛氭敼閫犲墠锛坄origin/main` 860a0dd锛?- `after-*.txt`锛氭敼閫犲悗
