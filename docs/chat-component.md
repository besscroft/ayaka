# Chat 缁勪欢璁捐涓?API 鏂囨。

> 鍩轰簬 [AI Elements](https://elements.ai-sdk.dev/) 缁勪欢搴撹鑼冿紝缁撳悎 Vercel AI SDK useChat锛?
> 鍦?Ayaka 娓叉煋灞傚疄鐜扮殑銆屽垱鎰忓瀷 Chat 浣撻獙銆嶅畬鏁磋璁＄涓?API 鎵嬪唽銆?

---

## 鐩綍

1. [璁捐鐩爣涓庡師鍒橾(#1-璁捐鐩爣涓庡師鍒?
2. [鏁翠綋鏋舵瀯](#2-鏁翠綋鏋舵瀯)
3. [瑙嗚璁捐瑙勮寖](#3-瑙嗚璁捐瑙勮寖)
4. [鏍稿績缁勪欢 API](#4-鏍稿績缁勪欢-api)
   - [4.1 ChatView](#41-chatview)
   - [4.2 MessageInput](#42-messageinput)
   - [4.3 MessageList](#43-messagelist)
   - [4.4 ai-elements 瀛愮粍浠禲(#44-ai-elements-瀛愮粍浠?
5. [鏁版嵁娴佷笌鏂囦欢闄勪欢](#5-鏁版嵁娴佷笌鏂囦欢闄勪欢)
6. [鑱婂ぉ鍘嗗彶绠＄悊](#6-鑱婂ぉ鍘嗗彶绠＄悊)
7. [i18n 鏂囨鎵╁睍](#7-i18n-鏂囨鎵╁睍)
8. [浣跨敤绀轰緥](#8-浣跨敤绀轰緥)
9. [鍙墿灞曠偣](#9-鍙墿灞曠偣)
10. [宸茬煡闄愬埗](#10-宸茬煡闄愬埗)

---

## 1. 璁捐鐩爣涓庡師鍒?

### 1.1 璁捐鐩爣

鍦ㄤ繚鐣欐牳蹇冭亰澶╁姛鑳界殑鍩虹涓婏紝铻嶅叆**鍒涙柊浜や簰**涓?\*瑙嗚璁捐\*\*锛屼富瑕佸洿缁曞叚涓柟闈細

| 妯″潡        | 鍩虹鑳藉姏                    | 鍒涙剰澧炲己                                                       |
| ------------ | ------------------------------ | ------------------------------------------------------------------ |
| 娑堟伅灞曠ず | 鏂囨湰 / 宸ュ叿璋冪敤 / 鎺ㄧ悊 | 涓€閿鍒?路 Hover 蹇嵎鍙嶅簲 路 鏂囦欢闄勪欢鐢诲粖               |
| 杈撳叆妗?    | 鏂囨湰杈撳叆 / 鍙戦€?          | 鑷€傚簲楂樺害 路 鈱?Enter 寮哄埗鍙戦€?路 鏅鸿兘鍗犱綅             |
| 鍙戦€佹寜閽? | 鍙戦€?/ 鍋滄                  | 鍙戦€佹€佸垏鎹㈠姩鐢?路 娴佸紡鑴夊啿                               |
| 琛ㄦ儏閫夋嫨 | 鏂囨湰 emoji                   | 6 鍒嗙被缃戞牸 + 鍏抽敭瀛楁悳绱紙涓嫳鏂囷級路 鍏夋爣绮惧噯鎻掑叆 |
| 鏂囦欢涓婁紶 | 閫夋嫨鏂囦欢                   | 鎷栨嫿 路 绮樿创 路 缂╃暐鍥?路 澶у皬闄愬埗                         |
| 鍘嗗彶璁板綍 | 鍒楄〃鏄剧ず                   | 瀹炴椂鎼滅储 路 鏃ユ湡鍒嗙粍锛堜粖澶?鏄ㄥぉ/鏈懆/鏇存棭锛?        |

### 1.2 璁捐鍘熷垯

```
瀹夊叏鎬?= 姝ｇ‘鎬?> 鏈€灏忓彉鏇?> 鍙鎬?> 涓€鑷存€?
```

- **鏋舵瀯娓呮櫚** 鈥斺€?澶嶇敤 ai-elements锛屾墿灞曠偣鏀舵暃鍦?`ai-elements/` 瀛愮洰褰?
- **渚濊禆鏈€灏忓寲** 鈥斺€?涓嶅紩鍏?emoji 搴擄紱att 鏂囦欢鐢ㄦ爣鍑?Web API
- **绫诲瀷瀹夊叏** 鈥斺€?鎵€鏈夋柊缁勪欢瀵煎嚭 `Props` 鎺ュ彛锛涗笌 ai-sdk `FileUIPart` 鍗忚鍏煎
- \*_鍙闂€?_ 鈥斺€?鍏ㄩ儴浜や簰鍏冪礌鍚?`aria-label`銆侀敭鐩樺彲杈俱€乫ocus-visible 鍙
- \*_鍝嶅簲寮?_ 鈥斺€?妗岄潰绔粠 1024px 璧疯嚜閫傚簲锛沬nput 楂樺害 16px 鈫?152px 鑷姩鎾戦珮
- **鏆楄壊浼樺厛** 鈥斺€?鍚屾椂鍏煎 shadcn/base-ui 鐨?`data-theme` 涓?Tailwind v4 鐨?`dark` 鍙樹綋

### 1.3 鍒涙剰浜や簰浜偣

1. **鎷栨嫿 / 绮樿创涓婁紶** 鈥斺€?Composer 鏁翠釜鍖哄煙鏄?drop zone锛屾嫋鍏ユ枃浠舵椂楂樹寒锛坅ccent 鑹?+ 4px ring锛?
2. **Hover 澶嶅埗 / 琛ㄦ儏鍙嶅簲** 鈥斺€?榧犳爣绉讳笂 assistant 娑堟伅鏃舵诞鐜板伐鍏锋潯锛岀幓鐠冩嫙鎬?+ scale 鍔ㄧ敾
3. \*_绌烘€佸缓璁?_ 鈥斺€?鏂板璇濊嚜鍔ㄥ睍绀?4 鏉?prompt锛岀偣鍑荤洿鎺ュ彂閫?
4. **鏃ユ湡鍒嗙粍** 鈥斺€?宸︿晶鍘嗗彶鎸変粖澶?/ 鏄ㄥぉ / 鏈懆 / 鏇存棭 鍒嗙粍
5. **鎷栨嫿寮忕矘璐村壀璐存澘鍥剧墖** 鈥斺€?鐩存帴 `Ctrl+V` 鎶婃埅鍥捐浆闄勪欢

---

## 2. 鏁翠綋鏋舵瀯

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?                         App.tsx                                 鈹?
鈹?  鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹?
鈹?  鈹侫ppShell  鈹? 鈹?          ChatView (route)                鈹?  鈹?
鈹?  鈹?         鈹? 鈹?  鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鈹?  鈹?
鈹?  鈹?路 nav    鈹? 鈹?  鈹?       MessageList                鈹?  鈹?  鈹?
鈹?  鈹?路 hist   鈹? 鈹?  鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?  鈹?  鈹?
鈹?  鈹?路 search 鈹? 鈹?  鈹? 鈹?Message 鈹傗啋 鈹?QuickReactions 鈹? 鈹?  鈹?  鈹?
鈹?  鈹?路 group  鈹? 鈹?  鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?  鈹?  鈹?
鈹?  鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?  鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?  鈹?  鈹?
鈹?                鈹?  鈹? 鈹?Message 鈹傗啋 鈹?MsgAttachments 鈹? 鈹?  鈹?  鈹?
鈹?                鈹?  鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?  鈹?  鈹?
鈹?                鈹?  鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鈹?  鈹?
鈹?                鈹?  鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鈹?  鈹?
鈹?                鈹?  鈹?      MessageInput (Composer)     鈹?  鈹?  鈹?
鈹?                鈹?  鈹? [馃槉] [馃搸] [Agent] [Model]   [鈫慮  鈹?  鈹?  鈹?
鈹?                鈹?  鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鈹?  鈹?
鈹?                鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?

         鈻? data flow  鈻?

鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?ai-elements/                                                      鈹?
鈹?  鈹溾攢 prompt-input.tsx         (鍙楁帶 textarea + submit)            鈹?
鈹?  鈹溾攢 conversation.tsx         (婊氬姩瀹瑰櫒)                          鈹?
鈹?  鈹溾攢 message.tsx              (姘旀场)                              鈹?
鈹?  鈹溾攢 reasoning.tsx            (鎶樺彔鎺ㄧ悊)                          鈹?
鈹?  鈹溾攢 tool.tsx                 (宸ュ叿璋冪敤)                          鈹?
鈹?  鈹溾攢 emoji-picker.tsx    鈽呮柊澧?(鍒嗙被 + 鎼滅储)                      鈹?
鈹?  鈹溾攢 attachment-chip.tsx 鈽呮柊澧?(寰呭彂閫?chip)                     鈹?
鈹?  鈹溾攢 quick-reactions.tsx 鈽呮柊澧?(hover 鍙嶅簲)                      鈹?
鈹?  鈹溾攢 message-attachments.tsx 鈽呮柊澧?(娑堟伅闄勪欢鐢诲粖)                 鈹?
鈹?  鈹斺攢 prompt-suggestions.tsx   鈽呮柊澧?(绌烘€佸缓璁?                    鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

### 2.1 妯″潡鍒嗗眰

| 灞?            | 鍏虫敞鐐?                                | 鏂囦欢                                |
| -------------- | ---------------------------------------- | ------------------------------------- |
| 璺敱 / 瀹瑰櫒 | 鍔犺浇鍘嗗彶銆侀敊璇鐞嗐€佸彂閫佹帶鍒? | `ChatView.tsx`                        |
| 灞曠ず         | 娑堟伅娓叉煋銆乧omposer銆侀檮浠跺睍绀?   | `MessageList.tsx`, `MessageInput.tsx` |
| 鍘熷瓙缁勪欢   | emoji銆乧hip銆乺eaction銆乻uggestion     | `ai-elements/*.tsx`                   |
| 鎸佷箙鍖?      | IPC / DB                                 | `lib/api.ts`锛坧reload 鏆撮湶锛?      |

### 2.2 涓嶅彉寮忥紙閲嶈绾︽潫锛?

- **onSend 绛惧悕**锛歚(payload: { text, files: FilePartLike[] }) => void`
- **files[i] 瀛楁**锛歚type, mediaType, filename, url`锛堜笌 ai-sdk `FileUIPart` 涓€鑷达紱url 瀛楁鎵胯浇 dataURL锛?
- **鍘嗗彶鍥炲～**锛歚api.messages.list` 杩斿洖鐨?`content` 瀛楁鏄?JSON 搴忓垪鍖栫殑 UIMessage锛堝惈 parts锛?
- **浼氳瘽鍒囨崲**锛氶€氳繃 `conversationId` prop锛沗useChat({ id: conversationId })` 瑙﹀彂閲嶆柊璁㈤槄

---

## 3. 瑙嗚璁捐瑙勮寖

### 3.1 璁捐浠ょ墝锛堢户鎵胯嚜 shadcn/base-ui + Tailwind v4锛?

```css
/* 棰滆壊锛堝己璋冭壊闅忎富棰樺彉鍖栵級 */
--color-accent        /* 涓诲己璋冭壊锛堟寜閽€侀摼鎺ャ€乫ocus ring锛?*/
--color-accent-soft   /* 寮鸿皟鑹?10% 閫忔槑锛堣儗鏅級 */

/* 璇箟鑹?*/
--color-success       /* 澶嶅埗鎴愬姛銆佸彂閫佹垚鍔?*/
--color-warning       /* 缂哄皯妯″瀷銆佹湭閫夋ā鍨嬭鍛?*/
--color-danger        /* 閿欒銆佸垹闄?*/

/* 鏂囧瓧灞傜骇 */
--color-foreground         /* 涓绘枃瀛?*/
--color-foreground-70%     /* 娆＄骇鏂囧瓧 */
--color-foreground-45%     /* 鎻愮ず鏂囧瓧 */
--color-foreground-35%     /* 鏋佸急鎻愮ず */
--color-foreground-10%     /* 鍒嗛殧绾?*/

/* 鍦嗚 */
--radius-input-card: 24px  /* Composer 鍦嗚 */
--radius-bubble: 20px      /* 娑堟伅姘旀场 */
--radius-chip: 12px        /* 闄勪欢 chip */
--radius-emoji-grid: 8px   /* emoji 鏍煎瓙 */

/* 闃村奖 */
--shadow-composer: 0 18px 60px -42px rgba(15, 23, 42, 0.65)
--shadow-emoji-picker: 2xl  /* z-50, mb-2 */
--shadow-bubble: subtle

/* 闂磋窛 */
--gap-composer-padding-x: 16px
--gap-composer-padding-y: 12px
--gap-attachment-row: 6px
```

### 3.2 鍏抽敭鐣岄潰绀烘剰

#### 3.2.1 Composer锛堟秷鎭緭鍏ユ锛?

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?[馃柤锔?1.png] [馃搫 readme.pdf]                鈫?闄勪欢棰勮 鈹?
鈹?鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?
鈹?鈹?Ask Ayaka anything...                              鈹?鈹?
鈹?鈹?(auto-expand up to 152px)                          鈹?鈹?
鈹?鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?
鈹?[馃槉] [馃搸] 鈹?[Agent] [Model]               [鈴?/ 鈫慮   鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
   border: foreground/15
   focus-within: border-accent/45 + ring-accent/10
   drag-over:   border-accent/60 + ring-accent/15
   no-model:    border-warning/35
```

#### 3.2.2 Emoji Picker

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?馃攳 鎼滅储 emoji...        鉁? 鈹? 鈫?鎼滅储妗?
鈹溾攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?馃榾 馃槀 馃槂 馃槃 馃榿 馃槅 馃槄 馃ぃ   鈹? 鈫?鍒嗙被 tab
鈹溾攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?馃榾 馃槂 馃槃 馃榿 馃槅 馃槄 馃ぃ 馃槀   鈹? 鈫?8 鍒楃綉鏍?
鈹?馃檪 馃檭 馃槈 馃槉 馃槆 馃グ 馃槏 馃ぉ   鈹?
鈹?馃槝 馃槜 馃槡 馃槞 馃ゲ 馃構 馃槢 馃槣   鈹?
鈹?... (max-h-240 婊氬姩)       鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
   灏哄: 320 脳 鑷€傚簲
   鍦嗚: 16px
   鑳屾櫙: 鐜荤拑鎷熸€?
```

#### 3.2.3 Hover 宸ュ叿鏉★紙娑堟伅锛?

```
                            鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                            鈹?馃憤 鉂わ笍 馃帀 馃槀 馃 馃敟鈹? 鈫?QuickReactions
                            鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
   鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
   鈹?杩欐槸 AI 鐨勫洖澶?..                            鈹? 鈫?鍔╂墜娑堟伅
   鈹?                                         鈹? 鈫?鏂囨湰
   鈹?[馃搵 澶嶅埗]   宸插鍒?                         鈹? 鈫?Copy (hover 鏄剧ず)
   鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

#### 3.2.4 娑堟伅闄勪欢

```
   鐢ㄦ埛娑堟伅:
   鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
   鈹?[鍥?] [鍥?] [鍥?]                     鈹? 鈫?鍥剧墖缃戞牸锛堟渶澶?3 鍒楋級
   鈹?[馃搫 readme.pdf]  2.3 MB              鈹? 鈫?鏂囦欢 chip
   鈹?杩欐槸闂鎻忚堪...                         鈹? 鈫?鏂囨湰
   鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

#### 3.2.5 渚ф爮鍘嗗彶鍒嗙粍

```
   鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€  瀵硅瘽鍘嗗彶          [+] 鈹€鈹€鈹€
   馃攳 鎼滅储浼氳瘽...                         鈫?鎼滅储妗?

   浠婂ぉ
     馃挰 瑙ｉ噴閲忓瓙璁＄畻                馃棏
     馃挰 React 缁勪欢璁捐                馃棏

   鏄ㄥぉ
     馃挰 鍏充簬 TypeScript                馃棏

   鏈懆
     馃挰 鍛ㄤ細璁▼                      馃棏

   鏇存棭
     馃挰 鏃呰璁″垝                      馃棏
```

### 3.3 鍔ㄦ晥瑙勮寖

| 鍏冪礌                 | 鍔ㄦ晥                              | 鏃堕暱 | 缂撳姩   |
| ---------------------- | ----------------------------------- | ------ | -------- |
| Emoji Picker 鍑虹幇    | fade + scale(0.95鈫?) + slideUp 4px | 150ms  | ease-out |
| Quick Reactions 鍑虹幇 | scale(0.95鈫?) + fade               | 150ms  | ease-out |
| Suggestion hover       | translateY(-2px) + border 鍙?       | 150ms  | ease-out |
| 闄勪欢 chip 鍑虹幇     | fade                                | 200ms  | ease-out |
| 鎷栨嫿楂樹寒           | border + ring 鍙?                   | 200ms  | ease-out |
| Drop overlay 鍑虹幇    | fade                                | 100ms  | ease-out |

### 3.4 棰滆壊瀵规瘮搴︼紙鏃犻殰纰嶏級

- 涓绘枃瀛?/ 鑳屾櫙锛氣墺 7:1
- 娆＄骇鏂囧瓧 / 鑳屾櫙锛氣墺 4.5:1
- 寮鸿皟鑹叉寜閽枃瀛楋細濮嬬粓鐧?娣辫壊锛堣嚜鍔ㄥ姣旓級
- 鐒︾偣鐜細accent + 4px ring锛堜笉渚濊禆棰滆壊鎰熺煡锛?

---

## 4. 鏍稿績缁勪欢 API

### 4.1 ChatView

```ts
interface ChatViewProps {
  conversationId: string;
  serverInfo: LocalServerInfo; // 鏉ヨ嚜 main 杩涚▼锛坧ort + token锛?
}
```

**鑱岃矗**锛?

- 鍔犺浇浼氳瘽鍘嗗彶
- 绠＄悊 `useChat`锛圴ercel AI SDK锛?
- 閿欒鎹曡幏 + 鎸佷箙鍖?
- 娓叉煋绌烘€?/ 鍒楄〃 / Composer

\**鐘舵€?*锛?

| 鐘舵€?            | 绫诲瀷           | 鐢ㄩ€?                          |
| ----------------- | ---------------- | ------------------------------- |
| `selectedModel`   | `string \| null` | 鍏宠仈 SettingKey.SelectedModel |
| `selectedAgentId` | `string \| null` | 鍏宠仈 SettingKey.ActiveAgentId |
| `initialMessages` | `UIMessage[]`    | 浠?DB 鍔犺浇                    |
| `historyLoaded`   | `boolean`        | 鎺у埗 loading 鎬?               |
| `chatError`       | `string \| null` | UI 閿欒灞曠ず                  |

**鍏抽敭琛屼负**锛?

```ts
// 1) 鍘嗗彶鍔犺浇锛氭瘡娆?conversationId 鍙樺寲
useEffect(() => {
  void api.messages.list(conversationId).then((rows) => {
    // row.content 鏄?JSON 搴忓垪鍖栫殑 UIMessage
    const msgs = rows.map((row) => JSON.parse(row.content));
    setInitialMessages(msgs);
  });
}, [conversationId]);

// 2) 鍙戦€佹秷鎭紙鏀寔闄勪欢锛?
const handleSend = async ({ text, files }) => {
  // 鎶?FilePartLike[] 杞?ai-sdk FileUIPart[]
  // 棰勪繚瀛樺埌 DB锛堝紓姝ワ級
  // 瑙﹀彂娴佸紡鍝嶅簲
};

// 3) 閿欒澶勭悊锛歰nError 鎸佷箙鍖栧埌 DB + toast
```

---

### 4.2 MessageInput

```ts
interface MessageInputProps {
  isLoading: boolean;
  /** 鍙戦€佸洖璋冿細鍖呭惈鏂囨湰涓庢枃浠讹紙ai-sdk FileUIPart[]锛?*/
  onSend: (payload: { text: string; files: FilePartLike[] }) => void;
  /** 娴佸紡涓厑璁稿仠姝?*/
  onStop?: () => void;
  selectedModel: string | null;
  selectedAgentId: string | null;
  onModelChange: (modelRef: string | null) => void;
  onAgentChange: (agentId: string) => void;
  /** 鍗曚釜闄勪欢鏈€澶у瓧鑺傛暟锛堥粯璁?10MB锛?*/
  maxFileSize?: number;
  /** 鍏佽鐨?MIME 绫诲瀷鍓嶇紑 */
  accept?: string;
}
```

\**鐗规€?*锛?

- 鑷€傚簲楂樺害锛?6px 鈫?152px锛?
- 鈱?Ctrl + Enter 寮哄埗鍙戦€?
- 鎷栨嫿 / 绮樿创鏂囦欢
- Emoji 閫夋嫨鍣紙鍏夋爣浣嶇疆鎻掑叆锛?
- 瀹炴椂鏄剧ず闄勪欢棰勮涓庡ぇ灏?
- 娴佸紡涓樉绀哄仠姝㈡寜閽紝鍋滄鏃朵笉褰卞搷涓嬫鍙戦€?

\**鍐呴儴瀛愮粍浠?*锛?

```
<PromptInput status={status} onSubmit={handleSubmit}>
  <PromptInputTextarea ref={textareaRef} ... />
  <EmojiPicker open={emojiOpen} onOpenChange={setEmojiOpen} onSelect={handleEmojiSelect} />
  <AttachmentChip item={a} onRemove={removeAttachment} />  // 姣忎釜闄勪欢
  <AgentSelector />
  <ModelSelector />
  <PromptInputSubmit status={status} disabled={!canSend} />
</PromptInput>
```

**鏆撮湶鐨?PendingAttachment 绫诲瀷**锛?

```ts
export interface PendingAttachment extends AttachmentItem {
  file: File; // 鍘熷 File 寮曠敤
}
```

---

### 4.3 MessageList

```ts
interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  error?: Error;
  errorDetail?: string | null;
  onRetry?: () => void;
  onDismissError?: () => void;
}
```

**鍐呴儴缁撴瀯**锛?

```
<Conversation>
  <ConversationContent>
    {messages.map(m => (
      <Message from={m.role}>
        <Reasoning>...</Reasoning>
        <MessageAttachments parts={fileParts} />   {/* 鍥剧墖 + 鏂囦欢 */}
        <MessageResponse>...</MessageResponse>
        <Tool>...</Tool>
        <QuickReactions onReact={...} />           {/* 鍒涙剰 */}
        <CopyButton />                             {/* hover 澶嶅埗 */}
      </Message>
    ))}
    {error && <ErrorBanner />}
  </ConversationContent>
  <ConversationScrollButton />
</Conversation>
```

---

### 4.4 ai-elements 瀛愮粍浠?

#### 4.4.1 `<EmojiPicker>`

```ts
interface EmojiPickerProps {
  open: boolean; // 鍙楁帶
  onOpenChange: (open: boolean) => void;
  onSelect: (emoji: string) => void; // 閫変腑鍥炶皟
  onCategoryChange?: (id: string) => void;
  categories?: EmojiCategory[]; // 鑷畾涔夊垎绫?
  placeholder?: string;
}
```

**鍐呯疆鏁版嵁**锛歚DEFAULT_EMOJI_CATEGORIES`锛? 绫?~180 涓?emoji锛岄檮鍏抽敭瀛楋級

**浣跨敤绀轰緥**锛?

```tsx
const [open, setOpen] = useState(false);

<button onClick={() => setOpen(true)}>馃槉</button>
<EmojiPicker
  open={open}
  onOpenChange={setOpen}
  onSelect={(e) => insertAtCursor(e)}
  placeholder="鎼滅储..."
/>
```

**閿洏浜や簰**锛?

- Esc 鍏抽棴
- 鐐瑰嚮澶栭儴鍏抽棴
- 杈撳叆鍏抽敭瀛楄繃婊ゅ綋鍓嶅垎绫?

---

#### 4.4.2 `<AttachmentChip>`

```ts
interface AttachmentItem {
  id: string;
  file?: File;
  name: string;
  mediaType: string;
  size: number;
  url?: string;
  variant?: "image" | "video" | "audio" | "file";
}

interface AttachmentChipProps {
  item: AttachmentItem;
  onRemove?: (id: string) => void; // 涓嶄紶鍒欎笉鏄剧ず绉婚櫎鎸夐挳
  compact?: boolean; // 绱у噾妯″紡锛堟秷鎭腑灞曠ず锛?
}
```

**浣跨敤绀轰緥**锛?

```tsx
<AttachmentChip
  item={{ id: "1", name: "photo.png", mediaType: "image/png", size: 12345, file }}
  onRemove={(id) => setList((prev) => prev.filter((x) => x.id !== id))}
/>
```

**鍙樹綋**锛?

- `image`锛氭樉绀虹缉鐣ュ浘锛圤bjectURL锛?
- `video` / `audio` / `file`锛氭樉绀?SVG icon 鍗犱綅

---

#### 4.4.3 `<QuickReactions>`

```ts
export const DEFAULT_REACTIONS: readonly string[] = [
  "馃憤",
  "鉂わ笍",
  "馃帀",
  "馃槀",
  "馃",
  "馃敟",
];

interface QuickReactionsProps {
  onReact: (emoji: string) => void;
  reactions?: readonly string[]; // 鑷畾涔?
  placement?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}
```

**浣跨敤**锛氬繀椤绘斁鍦?`className="group/msg"` 瀹瑰櫒鍐咃紙榛樿 hover 琛屼负閫氳繃 `group-hover/msg:opacity-100` 瑙﹀彂锛?

```tsx
<div className="group/msg relative">
  <MessageResponse>{text}</MessageResponse>
  <QuickReactions onReact={(emoji) => console.log(emoji)} />
</div>
```

**瑙嗚**锛氱幓鐠冩嫙鎬侊紝hover/focus 瀹瑰櫒鏃堕€忔槑搴?0鈫? + scale 0.95鈫?

---

#### 4.4.4 `<MessageAttachments>`

```ts
export interface FilePartLike {
  type: string;
  mediaType?: string;
  filename?: string;
  url?: string; // ai-sdk 鏍囧噯
  data?: string; // 鍏煎鏃у瓧娈?
}

interface MessageAttachmentsProps {
  parts: FilePartLike[];
  className?: string;
}
```

**娓叉煋瑙勫垯**锛?

- 鍥剧墖锛氳嚜閫傚簲缃戞牸锛? / 2 / 3 鍒楋級
- 鍏朵粬锛氭í鎺?chip

**浣跨敤**锛?

```tsx
const fileParts = message.parts.filter((p) => p.type === "file");
<MessageAttachments parts={fileParts} />;
```

---

#### 4.4.5 `<PromptSuggestions>`

```ts
interface PromptSuggestionsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  title?: string;
}
```

**浣跨敤**锛堝吀鍨嬶細绌烘€侊級锛?

```tsx
<PromptSuggestions
  title="璇曡瘯杩欎簺闂"
  suggestions={["瑙ｉ噴閲忓瓙璁＄畻", "鍐欎竴棣栬瘲", "..."]}
  onSelect={(s) => sendMessage(s)}
/>
```

---

## 5. 鏁版嵁娴佷笌鏂囦欢闄勪欢

### 5.1 鏂囦欢闄勪欢瀹屾暣娴佺▼

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鐢ㄦ埛鎷栨嫿/绮樿创/閫夋嫨
鈹? File 瀵硅薄   鈹?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?                                 鈻?
                              鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                              鈹? MessageInput.ingestFiles()     鈹?
                              鈹? - 澶у皬鏍￠獙 (<10MB)              鈹?
                              鈹? - MIME 鏍￠獙                    鈹?
                              鈹? - 鐢熸垚 PendingAttachment      鈹?
                              鈹? - 鏄剧ず AttachmentChip          鈹?
                              鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                                                  鈹?鐢ㄦ埛鐐瑰嚮鍙戦€?
                                                  鈻?
                              鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                              鈹? MessageInput.flushSubmit()      鈹?
                              鈹? - readFileAsDataURL(file)        鈹?
                              鈹? - 鏋勯€?FilePartLike             鈹?
                              鈹? - 璋冪敤 onSend                   鈹?
                              鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                                                  鈹?
                                                  鈻?
                              鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                              鈹? ChatView.handleSend()          鈹?
                              鈹? - 杞?ai-sdk FileUIPart          鈹?
                              鈹? - 棰勪繚瀛樺埌 DB锛圓PI锛?           鈹?
                              鈹? - chat.sendMessage({text,files})鈹?
                              鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                                                  鈹?
                                                  鈻?
                              鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
                              鈹? Hono Server (main process)      鈹?
                              鈹? - 瑙ｆ瀽 multipart                鈹?
                              鈹? - 璋冪敤 AI SDK                   鈹?
                              鈹? - 娴佸紡杩斿洖                      鈹?
                              鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

### 5.2 鏁版嵁鏍煎紡绾﹀畾

| 瀛楁                  | 绫诲瀷                | 鍗忚                                           |
| ---------------------- | --------------------- | ----------------------------------------------- |
| `FileUIPart.url`       | `string`              | base64 dataURL锛坄data:image/png;base64,...`锛? |
| `FileUIPart.mediaType` | `string`              | IANA MIME                                       |
| `FileUIPart.filename`  | `string \| undefined` | 鏂囦欢鍚?                                       |

\**鍏抽敭鐐?*锛歛i-sdk v2+ 鐨?`FileUIPart` 鐢?`url` 瀛楁鎵胯浇 dataURL锛堜笉鏄?`data`锛夈€傛湰椤圭洰缁熶竴浣跨敤 `url`銆?

### 5.3 鍘嗗彶娑堟伅鍥炲～

- DB 涓?`messages.content` 鏄畬鏁?UIMessage JSON 瀛楃涓?
- 鍖呭惈鎵€鏈?parts锛坱ext / file / tool-\* / reasoning锛?
- 鍔犺浇鏃剁洿鎺?`JSON.parse` 鍚庝氦缁?`useChat` 浣滀负 initialMessages

---

## 6. 鑱婂ぉ鍘嗗彶绠＄悊

### 6.1 澧炲己鐗规€?

`AppShell` 鐨勪細璇濆垪琛ㄦ柊澧炰簡涓変釜鑳藉姏锛?

1. \**鎼滅储妗?*锛堜粎鍦ㄦ湁浼氳瘽鏃舵樉绀猴級
2. **鏃ユ湡鍒嗙粍**锛堜粖澶?/ 鏄ㄥぉ / 鏈懆 / 鏇存棭锛?
3. \**鍒犻櫎鎸夐挳鐨勮瑙夋彁绀?*锛坔over 娴幇锛岀孩鍖栵級

### 6.2 瀹炵幇瑕佺偣

```ts
// 杩囨护 + 鍒嗙粍
const groupedConversations = useMemo(() => {
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? conversations.filter((c) => c.title.toLowerCase().includes(q))
    : conversations;
  // 鎸?updated_at 鍒嗙粍鍒?4 涓浐瀹?label
  // 椤哄簭锛氫粖澶?鈫?鏄ㄥぉ 鈫?鏈懆 鈫?鏇存棭
}, [conversations, searchQuery, t]);
```

### 6.3 API 涓庣幇鏈?IPC 鍏煎

- 浠嶄娇鐢?`api.conversations.list / .delete / .touch`
- 涓嶅鍔?IPC 璋冪敤娆℃暟
- 涓嶅奖鍝?Trash 琛屼负

---

## 7. i18n 鏂囨鎵╁睍

鏂板閿紙zh-CN + en锛夛細

```ts
// AppShell
"shell.conversations":       "瀵硅瘽鍘嗗彶" / "Conversations"
"shell.searchPlaceholder":   "鎼滅储浼氳瘽鈥? / "Search conversations鈥?
"shell.noSearchResult":      "娌℃湁鍖归厤鐨勪細璇? / "No matching conversations"
"shell.group.today":         "浠婂ぉ" / "Today"
"shell.group.yesterday":     "鏄ㄥぉ" / "Yesterday"
"shell.group.thisWeek":      "鏈懆" / "This week"
"shell.group.earlier":       "鏇存棭" / "Earlier"

// ChatView
"chat.empty.title":          "寮€濮嬩竴娈垫柊瀵硅瘽" / "Start a new conversation"
"chat.empty.subtitle":       "鍚?Ayaka 鎻愰棶..." / "Ask Ayaka anything..."
"chat.copy":                 "澶嶅埗娑堟伅" / "Copy message"
"chat.copied":               "宸插鍒? / "Copied"

// MessageInput
"input.placeholder.withAttachments": "娣诲姞涓€浜涙枃瀛?.." / "Add some text..."
"input.emoji":               "鎻掑叆琛ㄦ儏" / "Insert emoji"
"input.attach":              "涓婁紶闄勪欢" / "Attach file"
"input.dropHint":            "鏉炬墜鍗冲彲闄勫姞鏂囦欢" / "Drop files to attach"
"input.shortcutHint":        "Enter 鍙戦€?路 ..." / "Enter to send 路 ..."

// MessageList
"msg.copy":                  "澶嶅埗" / "Copy"
"msg.copied":                "宸插鍒? / "Copied"
```

---

## 8. 浣跨敤绀轰緥

### 8.1 鏈€灏忓寲闆嗘垚

```tsx
import { ChatView } from "@/components/ChatView";

function App() {
  return <ChatView conversationId="conv-123" serverInfo={{ port: 3939, token: "..." }} />;
}
```

### 8.2 鑷畾涔?Emoji 鍒嗙被

```tsx
import { EmojiPicker, type EmojiCategory } from "@/components/ai-elements";

const myCategories: EmojiCategory[] = [
  {
    id: "reactions",
    label: "甯哥敤",
    icon: "鈿?,
    entries: [
      { char: "馃憤", keywords: ["thumbs", "up"] },
      { char: "鉂わ笍", keywords: ["heart"] },
    ],
  },
];

<EmojiPicker open={open} onOpenChange={setOpen} onSelect={onSelect} categories={myCategories} />;
```

### 8.3 鑷畾涔夌┖鎬佸缓璁?

```tsx
const mySuggestions = ["鎬荤粨浠婂ぉ鐨勪細璁?, "涓烘柊椤圭洰璧蜂釜鍚嶅瓧", "瑙ｉ噴 TypeScript 鐨勭被鍨嬬郴缁?];

<PromptSuggestions title="璇曡瘯杩欎簺" suggestions={mySuggestions} onSelect={(s) => handleSend(s)} />;
```

### 8.4 鑷畾涔夋枃浠跺ぇ灏忛檺鍒?

```tsx
<MessageInput
  isLoading={isLoading}
  onSend={handleSend}
  selectedModel={model}
  selectedAgentId={agentId}
  onModelChange={setModel}
  onAgentChange={setAgentId}
  maxFileSize={5 * 1024 * 1024} // 5MB
  accept="image/*,application/pdf"
/>
```

### 8.5 瀹屾暣鑷畾涔夋秷鎭覆鏌?

```tsx
import {
  Message,
  MessageResponse,
  Reasoning,
  QuickReactions,
  MessageAttachments,
} from "@/components/ai-elements";

function CustomMessage({ message, onReact }) {
  return (
    <Message from={message.role} className="group/msg relative">
      <MessageAttachments parts={message.parts.filter((p) => p.type === "file")} />
      {message.parts.map((p, i) => {
        if (p.type === "text") return <MessageResponse key={i}>{p.text}</MessageResponse>;
        if (p.type === "reasoning") return <Reasoning key={i}>...</Reasoning>;
      })}
      <QuickReactions onReact={onReact} />
    </Message>
  );
}
```

---

## 9. 鍙墿灞曠偣

### 9.1 鏇挎崲 Emoji 瀛楀吀

`EmojiPicker` 鎺ュ彈 `categories` prop锛屽彲娉ㄥ叆瀹屾暣鑷畾涔夊瓧鍏革紙濡傚搧鐗屼笓灞?emoji锛夈€?

### 9.2 鑷畾涔夐檮浠?Chip 琛屼负

`<AttachmentChip onRemove={...}>` 鍙渷鐣ワ紝鍙樹负绾睍绀烘ā寮忥紱鍙互浼犲叆鏇村鏉傜殑 `variant` 鏉ユ墿灞曘€?

### 9.3 鏇挎崲 QuickReactions

閫氳繃 `reactions` prop 鏀瑰彉榛樿 6 涓弽搴旓紱閫氳繃 `placement` 鏀瑰彉浣嶇疆銆?

### 9.4 涓婚鑹叉墿灞?

鎵€鏈夊己璋冭壊 / 鐒︾偣鐜娇鐢?`accent` token銆備慨鏀?shadcn/base-ui 鐨勪富棰?bundle 鎴?Tailwind v4 鐨?`@theme` 鍗冲彲鍏ㄥ眬鐢熸晥銆?

### 9.5 i18n 鎵╁睍

浠呴渶鍦?`lib/i18n.tsx` 澧炲姞鏂伴敭锛涙柊璇█鍙渶鍦?`LOCALES` 鏁扮粍涓拷鍔犲苟琛ュ叏瀛楀吀銆?

### 9.6 鏂囦欢涓婁紶绠＄嚎鎵╁睍

`flushSubmit` 涓彲鎻掑叆锛?

- 瀹㈡埛绔帇缂╋紙鍥剧墖锛?
- 涓婁紶鍒板璞″瓨鍌ㄥ悗鐢?URL 鏇夸唬 dataURL
- 鐥呮瘨鎵弿閽╁瓙

---

## 10. 宸茬煡闄愬埗

1. \**澶ф枃浠跺崰鐢ㄥ唴瀛?*锛氬綋鍓嶆墍鏈夋枃浠?base64 鍚庨┗鐣欏湪鍐呭瓨涓紱瓒呰繃 10MB 鐨勬枃浠朵細琚嫆缁濓紙榛樿锛夈€傚闇€鏇村ぇ鏂囦欢锛屽缓璁鎴风鍘嬬缉鍚庝笂浼犮€?
2. \**鍥剧墖鐢诲粖鏃犲叏灞忛瑙?*锛歚<MessageAttachments>` 褰撳墠鍙睍绀虹缉鐣ュ浘锛岀偣鍑绘墦寮€鏂版爣绛鹃〉锛堟祻瑙堝櫒琛屼负锛夈€傚闇€ Lightbox锛岄渶鑷瀹炵幇銆?
3. **鍘嗗彶鍒嗙粍鍩轰簬鏈湴鏃堕棿**锛歚AppShell` 鐨勬棩鏈熷垎缁勬寜瀹㈡埛绔椂鍖鸿绠椼€傝法鏃跺尯鍒囨崲鍙兘瀵艰嚧鍒嗙粍浣嶇疆鍙樺寲銆?
4. **琛ㄦ儏鍙嶅簲鏈寔涔呭寲**锛歚<QuickReactions>` 褰撳墠鍥炶皟鍙Е鍙?`console.log + toast`锛屾湭鍐欏叆 DB銆傚闇€淇濈暀鍙嶉锛屽彲鎵╁睍 `handleReaction` 涓?messages 琛ㄣ€?
5. \**鎷栨嫿涓婁紶涓嶆樉绀哄疄鏃惰繘搴?*锛氬綋鍓嶄负銆屾澗鎵嬪嵆闄勫姞銆嶃€傚闇€鏄剧ず涓婁紶杩涘害鏉★紝鍙湪 `flushSubmit` 涓姞鍏ヨ繘搴︾姸鎬併€?

---

## 闄勫綍 A锛氭枃浠舵竻鍗?

| 鏂囦欢                                           | 鐘舵€?    | 琛屾暟锛堢害锛? | 鐢ㄩ€?               |
| ------------------------------------------------ | --------- | --------------- | -------------------- |
| `components/ChatView.tsx`                        | 閲嶆瀯    | 350             | 璺敱 + 鍙戦€佹帶鍒? |
| `components/MessageList.tsx`                     | 閲嶆瀯    | 240             | 娑堟伅娓叉煋         |
| `components/MessageInput.tsx`                    | 閲嶆瀯    | 415             | Composer             |
| `components/AppShell.tsx`                        | 澧炲己    | 305             | 渚ф爮 + 鍘嗗彶鍒嗙粍 |
| `components/ai-elements/emoji-picker.tsx`        | **鏂板** | 360             | 琛ㄦ儏閫夋嫨         |
| `components/ai-elements/attachment-chip.tsx`     | **鏂板** | 145             | 闄勪欢 chip          |
| `components/ai-elements/quick-reactions.tsx`     | **鏂板** | 70              | hover 鍙嶅簲         |
| `components/ai-elements/message-attachments.tsx` | **鏂板** | 95              | 娑堟伅闄勪欢         |
| `components/ai-elements/prompt-suggestions.tsx`  | **鏂板** | 55              | 绌烘€佸缓璁?         |
| `components/ai-elements/prompt-input.tsx`        | 澧炲己    | 230             | 鏆撮湶 ref           |
| `components/ai-elements/index.ts`                | 鏇存柊    | 鈥?             | 瀵煎嚭鏂扮粍浠?      |
| `components/icons.tsx`                           | 澧炲己    | 鈥?             | 鏂板 6 涓?icon      |
| `lib/i18n.tsx`                                   | 澧炲己    | 鈥?             | 鏂板 14 涓敭       |
| `docs/chat-component.md`                         | **鏂板** | 鈥?             | 鏈枃妗?             |

## 闄勫綍 B锛欰SCII 鐣岄潰鎬昏

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹? Ayaka                                  local                              鈹?
鈹?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鈹?
鈹? 馃彔 Ayaka OS       鈹屸攢 瀵硅瘽鍘嗗彶                       [+] 鈹€鈹?                 鈹?
鈹? 馃挰 Chat          鈹?馃攳 鎼滅储浼氳瘽鈥?                         鈹?                 鈹?
鈹? 馃 Agents        鈹?                                       鈹?                 鈹?
鈹? 鈿欙笍 Agent Loop   鈹?浠婂ぉ                                    鈹?                 鈹?
鈹? 馃捑 Memory        鈹?  馃挰 瑙ｉ噴閲忓瓙璁＄畻                馃棏    鈹?                 鈹?
鈹? 馃攼 Runtime       鈹?  馃挰 React 缁勪欢璁捐              馃棏    鈹?                 鈹?
鈹? 馃寪 Server        鈹?                                       鈹?                 鈹?
鈹? 馃枼锔?Interactions 鈹?鏄ㄥぉ                                    鈹?                 鈹?
鈹? 鈽€锔?Sync          鈹?  馃挰 TypeScript 瀛︿範               馃棏    鈹?                 鈹?
鈹?                 鈹?                                       鈹?                 鈹?
鈹?                 鈹?鏈懆                                    鈹?                 鈹?
鈹?                 鈹?  馃挰 鍛ㄤ細璁▼                       馃棏    鈹?                 鈹?
鈹?                 鈹?                                       鈹?                 鈹?
鈹?                 鈹?鏇存棭                                    鈹?                 鈹?
鈹?                 鈹?  馃挰 鏃呰璁″垝                       馃棏    鈹?                 鈹?
鈹?                 鈹?                                       鈹?                 鈹?
鈹?                 鈹?[鈿欙笍 Settings]                          鈹?                 鈹?
鈹?                 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?                 鈹?
鈹?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鈹?
鈹? 瀵硅瘽                                                                       鈹?
鈹?                                                                            鈹?
鈹?                                         鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?
鈹?                                         鈹?杩欐槸 AI 鐨勫洖澶嶅唴瀹?..            鈹?鈹?
鈹?                                         鈹?[馃搵 澶嶅埗]   宸插鍒?             鈹?鈹?
鈹?                                         鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?                                 鈹?
鈹? 鈹?杩欐槸鐢ㄦ埛鐨勯棶棰?..                          鈹?                                 鈹?
鈹? 鈹?[馃柤锔?photo.png] [馃搫 readme.pdf]              鈹?                                 鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?                                 鈹?
鈹?                                                                            鈹?
鈹?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ 鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?
鈹? 鈹?Ask Ayaka anything...                                                  鈹? 鈹?
鈹? 鈹?(auto-expand to 152px)                                                鈹? 鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?
鈹? [馃槉] [馃搸] 鈹?[Agent] [Model]                                    [鈴?/ 鈫慮   鈹?
鈹? Enter 鍙戦€?路 Shift+Enter 鎹㈣ 路 鈱?Ctrl+Enter 寮哄埗鍙戦€?                      鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

---

**鐗堟湰**锛歷1.0锛?026-07-04锛?
**浣滆€?\*锛歏oid AI Team
**渚濊禆**锛歊eact 19, shadcn/base-ui, Tailwind v4, Vercel AI SDK, ai-elements
**璁稿彲\*\*锛歁IT
