/**
 * AI Elements - EmojiPicker 组件
 *
 * 设计目标：
 *  - 不引入第三方 emoji 库（依赖最小化）
 *  - 提供分类网格 + 关键字搜索
 *  - 受控开关状态 + onSelect 回调
 *  - 暴露 anchor / onOpenChange 等 prop，便于嵌入到 PromptInput 的 popover
 *
 * 交互：
 *  - 点击分类 tab 切换显示分类
 *  - 搜索框输入关键字后实时过滤当前分类的 emoji
 *  - 点击 emoji 后触发 onSelect，关闭 popover
 *  - Esc 关闭 popover
 *  - 键盘上下/左右移动焦点，回车选中
 *
 * 数据：
 *  - 内部维护一份精简的 emoji 字典（仅常用 ~180 个），按分类组织
 *  - 搜索通过 emoji 的 keyword 标签进行匹配
 */
import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT, type TranslationKey } from "../../lib/i18n";
import { IconClose, IconSearch } from "../icons";

/** 单个 emoji 字典条目 */
export interface EmojiEntry {
  char: string;
  /** 关键字（用于搜索） */
  keywords: string[];
}

/** 分类 */
export interface EmojiCategory {
  id: string;
  /** 分类标题 i18n key（由调用方解析为 label） */
  label: string;
  /** 分类图标（也可由调用方注入） */
  icon: string;
  entries: EmojiEntry[];
}

/**
 * 内置 emoji 字典（精简版，按分类组织）
 *
 * 选择标准：日常聊天最常用的 ~180 个，覆盖表情 / 手势 / 心 / 食物 / 动物 / 物体 / 符号。
 * 关键字便于中英文搜索（如 "smile" / "笑"）。
 */
export const DEFAULT_EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "表情",
    icon: "😀",
    entries: [
      { char: "😀", keywords: ["smile", "grin", "笑", "开心"] },
      { char: "😃", keywords: ["smile", "笑"] },
      { char: "😄", keywords: ["smile", "joy", "笑"] },
      { char: "😁", keywords: ["smile", "grin", "笑"] },
      { char: "😆", keywords: ["laugh", "笑"] },
      { char: "😅", keywords: ["sweat", "笑"] },
      { char: "🤣", keywords: ["laugh", "rofl", "笑"] },
      { char: "😂", keywords: ["joy", "cry", "笑", "哭"] },
      { char: "🙂", keywords: ["smile", "笑"] },
      { char: "🙃", keywords: ["upside", "笑"] },
      { char: "😉", keywords: ["wink", "眨眼"] },
      { char: "😊", keywords: ["blush", "害羞", "笑"] },
      { char: "😇", keywords: ["angel", "天使"] },
      { char: "🥰", keywords: ["love", "love", "爱"] },
      { char: "😍", keywords: ["heart", "eyes", "爱"] },
      { char: "🤩", keywords: ["star", "eyes", "星星"] },
      { char: "😘", keywords: ["kiss", "亲"] },
      { char: "😗", keywords: ["kiss", "亲"] },
      { char: "😚", keywords: ["kiss", "亲"] },
      { char: "😙", keywords: ["kiss", "亲"] },
      { char: "🥲", keywords: ["smile", "cry", "笑哭"] },
      { char: "😋", keywords: ["yum", "好吃"] },
      { char: "😛", keywords: ["tongue", "舌头"] },
      { char: "😜", keywords: ["wink", "tongue", "眨眼"] },
      { char: "🤪", keywords: ["zany", "疯狂"] },
      { char: "😎", keywords: ["cool", "墨镜"] },
      { char: "🤓", keywords: ["nerd", "书呆子"] },
      { char: "🧐", keywords: ["monocle", "眼镜"] },
      { char: "🤔", keywords: ["think", "思考"] },
      { char: "🤨", keywords: ["eyebrow", "疑惑"] },
      { char: "😐", keywords: ["neutral", "无语"] },
      { char: "😑", keywords: ["expressionless", "无表情"] },
      { char: "😶", keywords: ["speechless", "无语"] },
      { char: "🙄", keywords: ["eye", "roll", "翻白眼"] },
      { char: "😏", keywords: ["smirk", "得意"] },
      { char: "😣", keywords: ["persevere", "坚持"] },
      { char: "😥", keywords: ["sad", "relief", "失望"] },
      { char: "😮", keywords: ["open", "mouth", "惊讶"] },
      { char: "🤐", keywords: ["zipper", "闭嘴"] },
      { char: "😯", keywords: ["hushed", "沉默"] },
      { char: "😪", keywords: ["sleepy", "困"] },
      { char: "😫", keywords: ["tired", "累"] },
      { char: "🥱", keywords: ["yawn", "哈欠"] },
      { char: "😴", keywords: ["sleep", "睡觉"] },
      { char: "😌", keywords: ["relieved", "放松"] },
      { char: "😛", keywords: ["tongue", "吐舌"] },
      { char: "🤤", keywords: ["drool", "流口水"] },
      { char: "😒", keywords: ["unamused", "不高兴"] },
      { char: "😓", keywords: ["sweat", "汗"] },
      { char: "😔", keywords: ["pensive", "沉思"] },
      { char: "😕", keywords: ["confused", "困惑"] },
      { char: "🙃", keywords: ["upside"] },
      { char: "🤑", keywords: ["money", "钱"] },
      { char: "🤗", keywords: ["hug", "抱"] },
      { char: "🤭", keywords: ["hand", "mouth", "捂嘴"] },
      { char: "🤫", keywords: ["shush", "嘘"] },
      { char: "🤔", keywords: ["think"] },
      { char: "🤐", keywords: ["zipper"] },
      { char: "🤨", keywords: ["eyebrow"] },
      { char: "😐", keywords: ["neutral"] },
      { char: "😑", keywords: ["expressionless"] },
      { char: "😶", keywords: ["speechless"] },
      { char: "😏", keywords: ["smirk"] },
      { char: "😒", keywords: ["unamused"] },
      { char: "🙄", keywords: ["eye", "roll"] },
      { char: "😬", keywords: ["grimace", "尴尬"] },
      { char: "🤥", keywords: ["liar", "说谎"] },
      { char: "😌", keywords: ["relieved"] },
      { char: "😔", keywords: ["pensive"] },
      { char: "😪", keywords: ["sleepy"] },
      { char: "🤤", keywords: ["drool"] },
      { char: "😴", keywords: ["sleep"] },
      { char: "😷", keywords: ["mask", "口罩"] },
      { char: "🤒", keywords: ["thermometer", "生病"] },
      { char: "🤕", keywords: ["bandage", "受伤"] },
      { char: "🤢", keywords: ["nauseous", "恶心"] },
      { char: "🤮", keywords: ["vomit", "呕吐"] },
      { char: "🤧", keywords: ["sneeze", "喷嚏"] },
      { char: "🥵", keywords: ["hot", "热"] },
      { char: "🥶", keywords: ["cold", "冷"] },
      { char: "🥴", keywords: ["woozy", "晕"] },
      { char: "😵", keywords: ["dizzy", "晕"] },
      { char: "🤯", keywords: ["explode", "爆炸头"] },
      { char: "🤠", keywords: ["cowboy", "牛仔"] },
      { char: "🥳", keywords: ["party", "派对"] },
      { char: "😎", keywords: ["cool"] },
      { char: "🤓", keywords: ["nerd"] },
      { char: "🧐", keywords: ["monocle"] },
      { char: "😕", keywords: ["confused"] },
      { char: "😟", keywords: ["worried", "担心"] },
      { char: "🙁", keywords: ["frown", "皱眉"] },
      { char: "☹️", keywords: ["frown"] },
      { char: "😮", keywords: ["open", "mouth"] },
      { char: "😯", keywords: ["hushed"] },
      { char: "😲", keywords: ["astonished", "震惊"] },
      { char: "😳", keywords: ["flushed", "脸红"] },
      { char: "🥺", keywords: ["pleading", "恳求"] },
      { char: "😦", keywords: ["frown", "open", "mouth"] },
      { char: "😧", keywords: ["anguished", "痛苦"] },
      { char: "😨", keywords: ["fearful", "害怕"] },
      { char: "😰", keywords: ["anxious", "焦虑"] },
      { char: "😥", keywords: ["sad", "relief"] },
      { char: "😢", keywords: ["cry", "哭"] },
      { char: "😭", keywords: ["sob", "大哭"] },
      { char: "😱", keywords: ["scream", "尖叫"] },
      { char: "😖", keywords: ["confounded", "痛苦"] },
      { char: "😣", keywords: ["persevere"] },
      { char: "😞", keywords: ["disappointed", "失望"] },
      { char: "😓", keywords: ["sweat"] },
      { char: "😩", keywords: ["weary", "疲倦"] },
      { char: "😫", keywords: ["tired"] },
      { char: "🥱", keywords: ["yawn"] },
      { char: "😤", keywords: ["triumph", "得意"] },
      { char: "😡", keywords: ["rage", "愤怒"] },
      { char: "😠", keywords: ["angry", "生气"] },
      { char: "🤬", keywords: ["swear", "咒骂"] },
      { char: "😈", keywords: ["devil", "恶魔"] },
      { char: "👿", keywords: ["imp", "小恶魔"] },
      { char: "💀", keywords: ["skull", "骷髅"] },
      { char: "☠️", keywords: ["skull"] },
      { char: "💩", keywords: ["poo", "屎"] },
      { char: "🤡", keywords: ["clown", "小丑"] },
      { char: "👹", keywords: ["ogre", "怪物"] },
      { char: "👺", keywords: ["goblin", "妖精"] },
      { char: "👻", keywords: ["ghost", "鬼"] },
      { char: "👽", keywords: ["alien", "外星人"] },
      { char: "👾", keywords: ["space", "游戏"] },
      { char: "🤖", keywords: ["robot", "机器人"] },
    ],
  },
  {
    id: "gestures",
    label: "手势",
    icon: "👋",
    entries: [
      { char: "👋", keywords: ["wave", "挥手"] },
      { char: "🤚", keywords: ["raised", "back", "手"] },
      { char: "🖐️", keywords: ["hand", "five", "手"] },
      { char: "✋", keywords: ["stop", "停"] },
      { char: "🖖", keywords: ["vulcan", "瓦肯"] },
      { char: "🫱", keywords: ["hand", "right", "手"] },
      { char: "🫲", keywords: ["hand", "left", "手"] },
      { char: "🫳", keywords: ["palm", "down", "手"] },
      { char: "🫴", keywords: ["palm", "up", "手"] },
      { char: "👌", keywords: ["ok", "好"] },
      { char: "🤌", keywords: ["pinch", "捏"] },
      { char: "🤏", keywords: ["pinch", "少量"] },
      { char: "✌️", keywords: ["victory", "胜利"] },
      { char: "🤞", keywords: ["crossed", "fingers", "祈祷"] },
      { char: "🫰", keywords: ["hand", "heart", "手"] },
      { char: "🤟", keywords: ["love", "you", "爱你"] },
      { char: "🤘", keywords: ["rock", "摇滚"] },
      { char: "🤙", keywords: ["call", "打电话"] },
      { char: "👈", keywords: ["left", "左"] },
      { char: "👉", keywords: ["right", "右"] },
      { char: "👆", keywords: ["up", "上"] },
      { char: "🖕", keywords: ["middle", "中指"] },
      { char: "👇", keywords: ["down", "下"] },
      { char: "☝️", keywords: ["index", "up", "一指"] },
      { char: "👍", keywords: ["thumbs", "up", "赞"] },
      { char: "👎", keywords: ["thumbs", "down", "踩"] },
      { char: "✊", keywords: ["fist", "拳"] },
      { char: "👊", keywords: ["punch", "出拳"] },
      { char: "🤛", keywords: ["fist", "left", "拳"] },
      { char: "🤜", keywords: ["fist", "right", "拳"] },
      { char: "👏", keywords: ["clap", "鼓掌"] },
      { char: "🙌", keywords: ["raise", "hands", "举"] },
      { char: "🫶", keywords: ["heart", "hands", "心"] },
      { char: "👐", keywords: ["open", "hands", "手"] },
      { char: "🤲", keywords: ["palms", "up", "together"] },
      { char: "🤝", keywords: ["handshake", "握手"] },
      { char: "🙏", keywords: ["pray", "祈祷", "谢谢"] },
      { char: "✍️", keywords: ["write", "写"] },
      { char: "💅", keywords: ["nail", "指甲"] },
      { char: "🤳", keywords: ["selfie", "自拍"] },
      { char: "💪", keywords: ["muscle", "肌肉"] },
    ],
  },
  {
    id: "hearts",
    label: "心与符号",
    icon: "❤️",
    entries: [
      { char: "❤️", keywords: ["heart", "love", "爱", "心"] },
      { char: "🧡", keywords: ["heart", "orange", "心"] },
      { char: "💛", keywords: ["heart", "yellow", "心"] },
      { char: "💚", keywords: ["heart", "green", "心"] },
      { char: "💙", keywords: ["heart", "blue", "心"] },
      { char: "💜", keywords: ["heart", "purple", "心"] },
      { char: "🖤", keywords: ["heart", "black", "心"] },
      { char: "🤍", keywords: ["heart", "white", "心"] },
      { char: "🤎", keywords: ["heart", "brown", "心"] },
      { char: "💔", keywords: ["heart", "break", "心碎"] },
      { char: "❣️", keywords: ["heart", "exclaim", "心"] },
      { char: "💕", keywords: ["heart", "two", "心"] },
      { char: "💞", keywords: ["heart", "revolving", "心"] },
      { char: "💓", keywords: ["heart", "beat", "心"] },
      { char: "💗", keywords: ["heart", "growth", "心"] },
      { char: "💖", keywords: ["heart", "sparkle", "心"] },
      { char: "💘", keywords: ["heart", "arrow", "心"] },
      { char: "💝", keywords: ["heart", "gift", "心"] },
      { char: "💟", keywords: ["heart", "decoration", "心"] },
      { char: "☮️", keywords: ["peace", "和平"] },
      { char: "✝️", keywords: ["cross", "十字"] },
      { char: "☪️", keywords: ["islam", "伊斯兰"] },
      { char: "🕉️", keywords: ["hindu", "印度教"] },
      { char: "☸️", keywords: ["buddhist", "佛教"] },
      { char: "✡️", keywords: ["star", "david", "犹太"] },
      { char: "🔯", keywords: ["star", "six", "六芒星"] },
      { char: "🕎", keywords: ["menorah", "烛台"] },
      { char: "☯️", keywords: ["yin", "yang", "阴阳"] },
      { char: "☦️", keywords: ["cross", "正教"] },
      { char: "🛐", keywords: ["worship", "崇拜"] },
      { char: "⛎", keywords: ["zodiac", "星座"] },
      { char: "♈", keywords: ["zodiac", "aries", "白羊"] },
      { char: "♉", keywords: ["zodiac", "taurus", "金牛"] },
      { char: "♊", keywords: ["zodiac", "gemini", "双子"] },
      { char: "♋", keywords: ["zodiac", "cancer", "巨蟹"] },
      { char: "♌", keywords: ["zodiac", "leo", "狮子"] },
      { char: "♍", keywords: ["zodiac", "virgo", "处女"] },
      { char: "♎", keywords: ["zodiac", "libra", "天秤"] },
      { char: "♏", keywords: ["zodiac", "scorpio", "天蝎"] },
      { char: "♐", keywords: ["zodiac", "sagittarius", "射手"] },
      { char: "♑", keywords: ["zodiac", "capricorn", "摩羯"] },
      { char: "♒", keywords: ["zodiac", "aquarius", "水瓶"] },
      { char: "♓", keywords: ["zodiac", "pisces", "双鱼"] },
      { char: "🆎", keywords: ["ab", "血型"] },
      { char: "🅱️", keywords: ["b", "血型"] },
      { char: "🆑", keywords: ["cl", "清除"] },
      { char: "🅾️", keywords: ["o", "血型"] },
      { char: "🆘", keywords: ["sos", "求助"] },
      { char: "❌", keywords: ["x", "no", "叉"] },
      { char: "⭕", keywords: ["o", "圈"] },
      { char: "🛑", keywords: ["stop", "停"] },
      { char: "⛔", keywords: ["no", "entry", "禁止"] },
      { char: "📛", keywords: ["name", "badge"] },
      { char: "🚫", keywords: ["prohibited", "禁止"] },
      { char: "💯", keywords: ["hundred", "100", "百分"] },
      { char: "💢", keywords: ["anger", "愤怒"] },
      { char: "♨️", keywords: ["hot", "springs", "温泉"] },
      { char: "💥", keywords: ["boom", "爆炸"] },
      { char: "💫", keywords: ["dizzy", "晕"] },
      { char: "💦", keywords: ["sweat", "drops", "汗"] },
      { char: "💨", keywords: ["dash", "快"] },
      { char: "🕳️", keywords: ["hole", "洞"] },
      { char: "💬", keywords: ["speech", "speech", "对话"] },
      { char: "🗨️", keywords: ["speech", "left", "对话"] },
      { char: "🗯️", keywords: ["anger", "right", "对话"] },
      { char: "💭", keywords: ["thought", "thought", "思考"] },
      { char: "💤", keywords: ["zzz", "sleep", "睡觉"] },
    ],
  },
  {
    id: "objects",
    label: "物体",
    icon: "💡",
    entries: [
      { char: "💡", keywords: ["bulb", "idea", "灯泡", "想法"] },
      { char: "🔦", keywords: ["flashlight", "手电"] },
      { char: "🕯️", keywords: ["candle", "蜡烛"] },
      { char: "📱", keywords: ["phone", "手机"] },
      { char: "💻", keywords: ["laptop", "电脑"] },
      { char: "🖥️", keywords: ["computer", "台式机"] },
      { char: "⌨️", keywords: ["keyboard", "键盘"] },
      { char: "🖱️", keywords: ["mouse", "鼠标"] },
      { char: "🖨️", keywords: ["printer", "打印机"] },
      { char: "💾", keywords: ["floppy", "磁盘"] },
      { char: "💿", keywords: ["cd", "光盘"] },
      { char: "📀", keywords: ["dvd", "dvd"] },
      { char: "📷", keywords: ["camera", "相机"] },
      { char: "📸", keywords: ["camera", "flash", "相机"] },
      { char: "📹", keywords: ["video", "camera", "摄像机"] },
      { char: "🎥", keywords: ["movie", "camera", "电影"] },
      { char: "📺", keywords: ["tv", "电视"] },
      { char: "📻", keywords: ["radio", "收音机"] },
      { char: "🎙️", keywords: ["microphone", "studio", "麦克风"] },
      { char: "🎚️", keywords: ["level", "slider", "调音"] },
      { char: "🎛️", keywords: ["control", "knobs", "控制"] },
      { char: "🧭", keywords: ["compass", "指南针"] },
      { char: "⏰", keywords: ["clock", "闹钟"] },
      { char: "⏳", keywords: ["hourglass", "沙漏"] },
      { char: "⌚", keywords: ["watch", "手表"] },
      { char: "📡", keywords: ["satellite", "卫星"] },
      { char: "🔋", keywords: ["battery", "电池"] },
      { char: "🔌", keywords: ["plug", "插头"] },
      { char: "🧯", keywords: ["fire", "extinguisher", "灭火器"] },
      { char: "🛢️", keywords: ["oil", "drum", "油桶"] },
      { char: "🛒", keywords: ["cart", "购物车"] },
      { char: "💰", keywords: ["money", "bag", "钱袋"] },
      { char: "💵", keywords: ["dollar", "美元"] },
      { char: "💴", keywords: ["yen", "日元"] },
      { char: "💶", keywords: ["euro", "欧元"] },
      { char: "💷", keywords: ["pound", "英镑"] },
      { char: "💸", keywords: ["money", "wings", "钱飞走"] },
      { char: "💳", keywords: ["credit", "card", "信用卡"] },
      { char: "✉️", keywords: ["envelope", "信封"] },
      { char: "📧", keywords: ["email", "邮件"] },
      { char: "📨", keywords: ["envelope", "arrow", "收信"] },
      { char: "📩", keywords: ["envelope", "arrow", "down"] },
      { char: "📤", keywords: ["outbox", "tray", "发件箱"] },
      { char: "📥", keywords: ["inbox", "tray", "收件箱"] },
      { char: "📦", keywords: ["package", "包裹"] },
      { char: "📫", keywords: ["mailbox", "closed", "邮箱"] },
      { char: "📪", keywords: ["mailbox", "open", "邮箱"] },
      { char: "📬", keywords: ["mailbox", "mail", "邮箱"] },
      { char: "📭", keywords: ["mailbox", "empty", "邮箱"] },
      { char: "📮", keywords: ["postbox", "邮筒"] },
      { char: "🗳️", keywords: ["ballot", "投票"] },
      { char: "✏️", keywords: ["pencil", "铅笔"] },
      { char: "✒️", keywords: ["pen", "钢笔"] },
      { char: "🖋️", keywords: ["fountain", "pen", "钢笔"] },
      { char: "🖊️", keywords: ["pen", "圆珠笔"] },
      { char: "🖌️", keywords: ["paintbrush", "画笔"] },
      { char: "🖍️", keywords: ["crayon", "蜡笔"] },
      { char: "📝", keywords: ["memo", "笔记"] },
      { char: "📁", keywords: ["folder", "文件夹"] },
      { char: "📂", keywords: ["folder", "open", "文件夹"] },
      { char: "📅", keywords: ["calendar", "日历"] },
      { char: "📆", keywords: ["calendar", "tear", "日历"] },
      { char: "📇", keywords: ["card", "index", "名片"] },
      { char: "📈", keywords: ["chart", "up", "上升"] },
      { char: "📉", keywords: ["chart", "down", "下降"] },
      { char: "📊", keywords: ["chart", "bar", "图表"] },
      { char: "📋", keywords: ["clipboard", "剪贴板"] },
      { char: "📌", keywords: ["pin", "图钉"] },
      { char: "📍", keywords: ["pin", "round", "图钉"] },
      { char: "📎", keywords: ["paperclip", "回形针"] },
      { char: "🖇️", keywords: ["paperclips", "回形针"] },
      { char: "📏", keywords: ["ruler", "尺子"] },
      { char: "📐", keywords: ["ruler", "三角尺"] },
      { char: "✂️", keywords: ["scissors", "剪刀"] },
      { char: "🗂️", keywords: ["dividers", "分页"] },
      { char: "🗒️", keywords: ["notepad", "便签"] },
      { char: "🗓️", keywords: ["calendar", "spiral", "日历"] },
      { char: "🗃️", keywords: ["file", "cabinet", "文件柜"] },
      { char: "🗄️", keywords: ["file", "cabinet", "文件柜"] },
    ],
  },
  {
    id: "food",
    label: "食物",
    icon: "🍎",
    entries: [
      { char: "🍎", keywords: ["apple", "苹果"] },
      { char: "🍐", keywords: ["pear", "梨"] },
      { char: "🍊", keywords: ["orange", "橙"] },
      { char: "🍋", keywords: ["lemon", "柠檬"] },
      { char: "🍌", keywords: ["banana", "香蕉"] },
      { char: "🍉", keywords: ["watermelon", "西瓜"] },
      { char: "🍇", keywords: ["grape", "葡萄"] },
      { char: "🍓", keywords: ["strawberry", "草莓"] },
      { char: "🫐", keywords: ["blueberry", "蓝莓"] },
      { char: "🍈", keywords: ["melon", "甜瓜"] },
      { char: "🍒", keywords: ["cherry", "樱桃"] },
      { char: "🍑", keywords: ["peach", "桃"] },
      { char: "🥭", keywords: ["mango", "芒果"] },
      { char: "🍍", keywords: ["pineapple", "菠萝"] },
      { char: "🥥", keywords: ["coconut", "椰子"] },
      { char: "🥝", keywords: ["kiwi", "猕猴桃"] },
      { char: "🍅", keywords: ["tomato", "番茄"] },
      { char: "🍆", keywords: ["eggplant", "茄子"] },
      { char: "🥑", keywords: ["avocado", "牛油果"] },
      { char: "🥦", keywords: ["broccoli", "西兰花"] },
      { char: "🥬", keywords: ["leafy", "绿叶"] },
      { char: "🥒", keywords: ["cucumber", "黄瓜"] },
      { char: "🌶️", keywords: ["pepper", "辣椒"] },
      { char: "🫑", keywords: ["pepper", "甜椒"] },
      { char: "🌽", keywords: ["corn", "玉米"] },
      { char: "🥕", keywords: ["carrot", "胡萝卜"] },
      { char: "🫒", keywords: ["olive", "橄榄"] },
      { char: "🧄", keywords: ["garlic", "蒜"] },
      { char: "🧅", keywords: ["onion", "洋葱"] },
      { char: "🥔", keywords: ["potato", "土豆"] },
      { char: "🍠", keywords: ["sweet", "potato", "红薯"] },
      { char: "🥐", keywords: ["croissant", "可颂"] },
      { char: "🥯", keywords: ["bagel", "贝果"] },
      { char: "🍞", keywords: ["bread", "面包"] },
      { char: "🥖", keywords: ["baguette", "法棍"] },
      { char: "🫓", keywords: ["flatbread", "饼"] },
      { char: "🥨", keywords: ["pretzel", "椒盐卷饼"] },
      { char: "🧀", keywords: ["cheese", "奶酪"] },
      { char: "🥚", keywords: ["egg", "鸡蛋"] },
      { char: "🍳", keywords: ["cooking", "煎蛋"] },
      { char: "🧈", keywords: ["butter", "黄油"] },
      { char: "🥞", keywords: ["pancakes", "煎饼"] },
      { char: "🧇", keywords: ["waffle", "华夫"] },
      { char: "🥓", keywords: ["bacon", "培根"] },
      { char: "🥩", keywords: ["steak", "牛排"] },
      { char: "🍗", keywords: ["poultry", "leg", "鸡腿"] },
      { char: "🍖", keywords: ["meat", "bone", "肉"] },
      { char: "🌭", keywords: ["hot", "dog", "热狗"] },
      { char: "🍔", keywords: ["burger", "汉堡"] },
      { char: "🍟", keywords: ["fries", "薯条"] },
      { char: "🍕", keywords: ["pizza", "披萨"] },
      { char: "🥪", keywords: ["sandwich", "三明治"] },
      { char: "🥙", keywords: ["stuffed", "flatbread", "卷饼"] },
      { char: "🧆", keywords: ["falafel", "炸豆丸子"] },
      { char: "🌮", keywords: ["taco", "塔可"] },
      { char: "🌯", keywords: ["burrito", "卷饼"] },
      { char: "🥗", keywords: ["salad", "沙拉"] },
      { char: "🥘", keywords: ["paella", "杂烩"] },
      { char: "🍝", keywords: ["pasta", "意面"] },
      { char: "🍜", keywords: ["ramen", "拉面"] },
      { char: "🍲", keywords: ["pot", "food", "锅"] },
      { char: "🍛", keywords: ["curry", "咖喱"] },
      { char: "🍣", keywords: ["sushi", "寿司"] },
      { char: "🍱", keywords: ["bento", "便当"] },
      { char: "🥟", keywords: ["dumpling", "饺子"] },
      { char: "🍤", keywords: ["fried", "shrimp", "炸虾"] },
      { char: "🍙", keywords: ["rice", "ball", "饭团"] },
      { char: "🍚", keywords: ["rice", "米饭"] },
      { char: "🍘", keywords: ["rice", "cracker", "米饼"] },
      { char: "🥠", keywords: ["fortune", "cookie", "签饼"] },
      { char: "🥮", keywords: ["moon", "cake", "月饼"] },
      { char: "🍢", keywords: ["oden", "关东煮"] },
      { char: "🍡", keywords: ["dango", "团子"] },
      { char: "🍧", keywords: ["shaved", "ice", "刨冰"] },
      { char: "🍨", keywords: ["ice", "cream", "冰淇淋"] },
      { char: "🍦", keywords: ["soft", "ice", "cream", "甜筒"] },
      { char: "🥧", keywords: ["pie", "派"] },
      { char: "🧁", keywords: ["cupcake", "杯子蛋糕"] },
      { char: "🍰", keywords: ["cake", "蛋糕"] },
      { char: "🎂", keywords: ["birthday", "生日蛋糕"] },
      { char: "🍮", keywords: ["pudding", "布丁"] },
      { char: "🍭", keywords: ["lollipop", "棒棒糖"] },
      { char: "🍬", keywords: ["candy", "糖"] },
      { char: "🍫", keywords: ["chocolate", "巧克力"] },
      { char: "🍿", keywords: ["popcorn", "爆米花"] },
      { char: "🍩", keywords: ["doughnut", "甜甜圈"] },
      { char: "🍪", keywords: ["cookie", "饼干"] },
    ],
  },
  {
    id: "nature",
    label: "动物与自然",
    icon: "🐶",
    entries: [
      { char: "🐶", keywords: ["dog", "puppy", "狗"] },
      { char: "🐱", keywords: ["cat", "kitten", "猫"] },
      { char: "🐭", keywords: ["mouse", "老鼠"] },
      { char: "🐹", keywords: ["hamster", "仓鼠"] },
      { char: "🐰", keywords: ["rabbit", "bunny", "兔"] },
      { char: "🦊", keywords: ["fox", "狐狸"] },
      { char: "🐻", keywords: ["bear", "熊"] },
      { char: "🐼", keywords: ["panda", "熊猫"] },
      { char: "🐨", keywords: ["koala", "考拉"] },
      { char: "🐯", keywords: ["tiger", "虎"] },
      { char: "🦁", keywords: ["lion", "狮"] },
      { char: "🐮", keywords: ["cow", "牛"] },
      { char: "🐷", keywords: ["pig", "猪"] },
      { char: "🐸", keywords: ["frog", "青蛙"] },
      { char: "🐵", keywords: ["monkey", "猴"] },
      { char: "🐔", keywords: ["chicken", "鸡"] },
      { char: "🐧", keywords: ["penguin", "企鹅"] },
      { char: "🐦", keywords: ["bird", "鸟"] },
      { char: "🐤", keywords: ["chick", "小鸡"] },
      { char: "🦆", keywords: ["duck", "鸭"] },
      { char: "🦅", keywords: ["eagle", "鹰"] },
      { char: "🦉", keywords: ["owl", "猫头鹰"] },
      { char: "🦇", keywords: ["bat", "蝙蝠"] },
      { char: "🐺", keywords: ["wolf", "狼"] },
      { char: "🐗", keywords: ["boar", "野猪"] },
      { char: "🐴", keywords: ["horse", "马"] },
      { char: "🦄", keywords: ["unicorn", "独角兽"] },
      { char: "🐝", keywords: ["bee", "蜜蜂"] },
      { char: "🐛", keywords: ["bug", "虫"] },
      { char: "🦋", keywords: ["butterfly", "蝴蝶"] },
      { char: "🐌", keywords: ["snail", "蜗牛"] },
      { char: "🐞", keywords: ["lady", "beetle", "瓢虫"] },
      { char: "🐢", keywords: ["turtle", "乌龟"] },
      { char: "🐍", keywords: ["snake", "蛇"] },
      { char: "🦖", keywords: ["dino", "恐龙"] },
      { char: "🐳", keywords: ["whale", "鲸"] },
      { char: "🐬", keywords: ["dolphin", "海豚"] },
      { char: "🐟", keywords: ["fish", "鱼"] },
      { char: "🐠", keywords: ["tropical", "fish", "热带鱼"] },
      { char: "🐡", keywords: ["blowfish", "河豚"] },
      { char: "🦈", keywords: ["shark", "鲨鱼"] },
      { char: "🐙", keywords: ["octopus", "章鱼"] },
      { char: "🐚", keywords: ["shell", "贝壳"] },
      { char: "🌸", keywords: ["cherry", "blossom", "樱花"] },
      { char: "💐", keywords: ["bouquet", "花束"] },
      { char: "🌹", keywords: ["rose", "玫瑰"] },
      { char: "🌺", keywords: ["hibiscus", "木槿"] },
      { char: "🌻", keywords: ["sunflower", "向日葵"] },
      { char: "🌼", keywords: ["blossom", "花"] },
      { char: "🌷", keywords: ["tulip", "郁金香"] },
      { char: "🌱", keywords: ["seedling", "幼苗"] },
      { char: "🌲", keywords: ["evergreen", "常青树"] },
      { char: "🌳", keywords: ["tree", "树"] },
      { char: "🌴", keywords: ["palm", "棕榈"] },
      { char: "🌵", keywords: ["cactus", "仙人掌"] },
      { char: "🌾", keywords: ["sheaf", "稻"] },
      { char: "🌿", keywords: ["herb", "草"] },
      { char: "☘️", keywords: ["shamrock", "三叶草"] },
      { char: "🍀", keywords: ["clover", "四叶草"] },
      { char: "🍁", keywords: ["maple", "枫叶"] },
      { char: "🍂", keywords: ["fallen", "leaf", "落叶"] },
      { char: "🍃", keywords: ["leaf", "wind", "叶"] },
      { char: "🌞", keywords: ["sun", "face", "太阳"] },
      { char: "🌝", keywords: ["moon", "face", "满月"] },
      { char: "🌚", keywords: ["new", "moon", "新月"] },
      { char: "🌕", keywords: ["full", "moon", "满月"] },
      { char: "🌖", keywords: ["waning", "gibbous"] },
      { char: "🌗", keywords: ["last", "quarter"] },
      { char: "🌘", keywords: ["waning", "crescent"] },
      { char: "🌑", keywords: ["new", "moon"] },
      { char: "🌒", keywords: ["waxing", "crescent"] },
      { char: "🌓", keywords: ["first", "quarter"] },
      { char: "🌔", keywords: ["waxing", "gibbous"] },
      { char: "🌙", keywords: ["crescent", "moon", "月"] },
      { char: "⭐", keywords: ["star", "星"] },
      { char: "🌟", keywords: ["star", "sparkle", "星"] },
      { char: "✨", keywords: ["sparkles", "闪光"] },
      { char: "⚡", keywords: ["lightning", "闪电"] },
      { char: "🔥", keywords: ["fire", "火"] },
      { char: "💧", keywords: ["droplet", "水滴"] },
      { char: "🌊", keywords: ["wave", "浪"] },
    ],
  },
];

interface EmojiPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (emoji: string) => void;
  /** 分类切换时的回调，可用于埋点 */
  onCategoryChange?: (categoryId: string) => void;
  /** 自定义分类列表；不传则使用 DEFAULT_EMOJI_CATEGORIES */
  categories?: EmojiCategory[];
  /** 自定义 placeholder */
  placeholder?: string;
  /** 关闭时是否聚焦到 anchor（由调用方控制） */
  children?: ReactNode;
}

const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  food: "ai.emoji.category.food",
  gestures: "ai.emoji.category.gestures",
  hearts: "ai.emoji.category.hearts",
  nature: "ai.emoji.category.nature",
  objects: "ai.emoji.category.objects",
  smileys: "ai.emoji.category.smileys",
};

type TFunction = ReturnType<typeof useT>["t"];

function getCategoryLabel(t: TFunction, category: EmojiCategory): string {
  const key = CATEGORY_LABEL_KEYS[category.id];
  return key ? t(key) : category.label;
}

/**
 * EmojiPicker 主体（Popover 容器）
 *
 * 使用：
 *   <EmojiPicker
 *     open={isOpen}
 *     onOpenChange={setOpen}
 *     onSelect={(e) => insertAtCursor(e)}
 *   />
 */
export function EmojiPicker({
  open,
  onOpenChange,
  onSelect,
  onCategoryChange,
  categories = DEFAULT_EMOJI_CATEGORIES,
  placeholder,
  className,
}: EmojiPickerProps): React.JSX.Element | null {
  const { t } = useT();
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const placeholderText = placeholder ?? t("ai.emoji.placeholder");

  // 关闭时清空搜索
  useEffect(() => {
    if (!open) {
      setQuery("");
    } else {
      // 打开时自动聚焦搜索框
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent): void => {
      const node = containerRef.current;
      if (!node) return;
      if (!node.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onOpenChange]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onOpenChange]);

  /** 搜索过滤：按关键字匹配当前分类的所有 emoji */
  const visibleEntries = useMemo<EmojiEntry[]>(() => {
    const cat = categories.find((c) => c.id === activeCategory) ?? categories[0];
    if (!cat) return [];
    if (!query.trim()) return cat.entries;
    const q = query.toLowerCase();
    return cat.entries.filter((entry) => {
      if (entry.char === q) return true;
      return entry.keywords.some((kw) => kw.toLowerCase().includes(q));
    });
  }, [activeCategory, categories, query]);

  // 搜索时若跨分类匹配数更多，可选切换分类；这里简化：保持当前分类
  const handleCategoryClick = (id: string): void => {
    setActiveCategory(id);
    onCategoryChange?.(id);
  };

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      data-slot="emoji-picker"
      role="dialog"
      aria-label={t("ai.emoji.picker")}
      className={cn(
        "absolute bottom-full left-0 z-50 mb-2 w-[320px] overflow-hidden",
        "rounded-lg border border-border bg-background shadow-lg",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2",
        className,
      )}
    >
      {/* 搜索框 */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <IconSearch className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={placeholderText}
          aria-label={t("ai.emoji.search")}
          className={cn(
            "h-6 flex-1 bg-transparent text-sm outline-none",
            "placeholder:text-muted-foreground",
          )}
        />
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label={t("ai.emoji.close")}
        >
          <IconClose className="size-3.5" />
        </button>
      </div>

      {/* 分类 tab */}
      <div role="tablist" className="flex items-center gap-0.5 border-b border-border px-1 py-1">
        {categories.map((cat) => {
          const isActive = cat.id === activeCategory;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleCategoryClick(cat.id)}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg text-base transition",
                isActive ? "bg-muted" : "opacity-50 hover:bg-muted hover:opacity-100",
              )}
              title={getCategoryLabel(t, cat)}
            >
              {cat.icon}
            </button>
          );
        })}
      </div>

      {/* emoji 网格 */}
      <div
        className="grid max-h-[240px] grid-cols-8 gap-0.5 overflow-y-auto p-2"
        data-slot="emoji-grid"
      >
        {visibleEntries.length === 0 ? (
          <p className="col-span-8 py-8 text-center text-xs text-muted-foreground">
            {t("ai.emoji.noMatch")}
          </p>
        ) : (
          visibleEntries.map((entry) => (
            <button
              key={entry.char}
              type="button"
              onClick={() => {
                onSelect(entry.char);
                onOpenChange(false);
              }}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-lg transition",
                "hover:bg-muted active:scale-95",
              )}
              title={entry.keywords[0] ?? entry.char}
              aria-label={t("ai.emoji.label", { label: entry.keywords[0] ?? entry.char })}
            >
              {entry.char}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
