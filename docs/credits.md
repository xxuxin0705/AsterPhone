# 来源记录（发布前看这里）

代码里不写「借鉴了谁」，都记在这个文件。以后加了别人的代码、字体、图片，或照着别人的项目做了什么，都往这里添一条。

## 一、照搬进来的代码（发布时必须标注）

（现在没有照搬进来的代码。以前的 `server-plugin/qrcode.js`（qrcode-generator，MIT）在 v0.8.6 删掉了。）

**装插件时下载的开源库**（不在我们仓库里，`npm install` 时下载；发布时在说明里写一句用到了它）：

| 用在哪 | 是什么 | 许可 |
|---|---|---|
| `server-plugin`（扫码 / 手机号登录、搜歌、歌单、歌词、播放地址…） | NeteaseCloudMusicApi 4.32.0，https://www.npmjs.com/package/NeteaseCloudMusicApi | MIT |
| `server-plugin`（QQ 音乐扫码登录、自己的歌单、会员播放地址） | @sansenjian/qq-music-api 2.6.0，https://www.npmjs.com/package/@sansenjian/qq-music-api | MIT |

## 二、只参考了思路、代码是自己写的（不强制，标上更礼貌）

| 用在哪 | 参考了什么 | 来源 | 许可 |
|---|---|---|---|
| `server-plugin/index.js`（改用 NeteaseCloudMusicApi 这个主意、二维码用 web 方式；QQ 登录用 qq-music-api、凭证存文件、从 cookie 里取 uin） | 作者发的「你自己的音乐源」插件，https://github.com/libertyseeyou/yourownmusicapiforST | MIT | 只参考思路 |
| `server-plugin/index.js`（早先的网易云接口地址、扫码登录的流程） | 哪些网易云接口不用加密就能调、扫码登录各个状态码的意思 | Anko3o/music-mcp-netease，https://github.com/Anko3o/music-mcp-netease | CC BY-NC-SA 4.0（不能商用；**如果以后照搬它的代码**，整个项目也得用同样的许可、不能商用，所以只学思路） |
| 电台（哄睡）页面的 2.5D 画风 | 小红书 Toska 的前端（窗台 / 书桌，three.js，AGPL-3.0） | 只参考画风，不用它的代码和图 |
| `server-plugin/index.js`（B 站：先拿 buvid3 再搜、`search/type` 搜视频、`view` 拿 cid、`playurl` 取地址，要带 Referer） | 弦 Xian（拿 B 站当曲库的安卓播放器） | 作者发的小红书笔记，https://github.com/TIUCSIB/Xian | 仓库没写许可；只参考思路，代码自己写 |
| `phone/core/music.js`（`qqFull` / `kuwoFull`：QQ 公共接口 tang.api.s01s.cn 按编号要整首、酷我接口 oiapi.net 按歌名搜再按序号要 mp3 的用法） | musicsquare（纯网页的音乐播放器） | 作者发的小红书笔记，https://github.com/CharlesPikachu/musicsquare | Apache-2.0；只参考接口用法，代码自己写 |
| 播放页「碎语 / 群唱」 | 全屏动态歌词的几种样子 | Folia（辞曲新境），AGPL-3.0 | 只参考样子，代码自己写，没用它的代码和图 |
| 音乐「一起听」 | 头像挨着、外侧耳机线的排法；头像上方白底气泡的样子 | 作者发的网易云「一起听」截图、一张带气泡的截图（来源未知） | 只参考样子，没用它们的图 |

## 三、字体和图片

| 文件 | 是什么 | 来源 / 风险 |
|---|---|---|
| `phone/assets/fonts/SFProDisplay-Bold.woff2` | 苹果 SF Pro Display Bold（锁屏时钟） | 苹果的字体，许可只让在苹果设备上用，**不允许拿去分发**。作者决定放进来、自己承担风险（`design-system.md` 里也记了）。公开发布前最好换成免费可商用的字体 |
| `phone/assets/music/rain-day.webp`、`rain-night.webp` | 下雨天皮肤的背景 | 作者给的图（v0.8.98 换成新的日间 / 夜间两张）。发布前确认是谁画的、能不能用 |
| `phone/assets/music/together-l.webp`、`together-r.webp` | 一起听的有线耳机 | 作者让 GPT 画的，去掉了黑底、切成两半 |
| `phone/assets/wallpapers/*`、`phone/assets/fab/*` | 壁纸、悬浮按钮 | 作者给的图（照 `gpt-image-brief*.md` 让画图模型画的）。发布前确认一遍 |

| 音乐播放页的 MV（QQ 的 m3u8 视频；看 MV 时才从 jsDelivr 下载，不放进仓库） | hls.js 1.5.20，https://github.com/video-dev/hls.js | Apache-2.0 |
| 歌词的内置字体（歌词设置、悬浮窗、一起听共用；从 jsDelivr 按需下载，不放进仓库） | 思源黑体 / 思源宋体、站酷快乐体 / 站酷小薇 / 站酷庆科黄油体、马善政楷书、龙藏体、志莽行书（@fontsource，都是 OFL）；霞鹜文楷、得意黑、汇文明朝体、朱雀仿宋（@chinese-fonts 中文网字计划打包，字体本身 OFL / 免费商用） | 可以免费商用 |

## 四、用到的外部服务（不是代码，写在说明里比较好）

- 搜歌 / 歌词：vkeys（https://api.vkeys.cn）
- 播放链接 / 歌单：Meting（默认 https://api.qijieya.cn/meting/）
- 装了服务器插件后：网易云音乐自己的接口
- 逐字歌词：AMLL TTML DB（https://github.com/amll-dev/amll-ttml-db，CC0，社区打轴），从 raw.githubusercontent.com 读
- 悬浮窗字体：jsDelivr（https://cdn.jsdelivr.net）
- 没装插件时解析歌单分享短链接：allorigins（https://api.allorigins.win）、corsproxy.io（https://corsproxy.io）、codetabs（https://api.codetabs.com），挨个试

## 念念树的图（phone/assets/memory/）
- 白天 / 夜里底图（sky-*）、风铃纸签（bell-* / tag-* / knot / chime-tube）：作者用豆包生成；底图右下角的「豆包 AI 生成」水印已抹掉，挂件从假的透明格子底上抠出来。
- 花瓣、雪花、枫叶（petal* / snow* / leaf*）：作者用 GPT 生成（黑底，转成了透明底）。

## 日记的图（phone/assets/diary/）
- 日记本封面（cover-*）、书桌白天 / 夜里（desk-*）、邮票框（stamp*）、和纸胶带（tape* / tape-pink* / strip*）、纸片小物（paper*）、干花（flower*）、蜡笔天气（weather-*）、三种纸（paper-*，从作者给的截图里裁出来，横线纸只留了线）、蕾丝（lace* / wlace*）、白蕾丝小物（wl*）、雪花 / 枫叶 / 樱花瓣（snow* / leaf* / petal*）：作者用 AI 生成或提供；黑底 / 白底的抠成了透明底（白蕾丝 wl* / wlace* 换成作者重给的黑底版，按亮度抠，越亮越不透明，留住半透明的网纱），一张多个的拆成单个。

## 日记的主题色（core/diary.js 的 THEMES）
- 作者挑的：「中国传统色 · 春季篇」（二十四节气配色，照抄色号和名字）、Vainny 的四组色卡（从截图上取色，名字是我按颜色起的：珊瑚、晚霞、海雾…）。

## 日记的字体（apps/diary/diary.js 的 FONTS，从 jsDelivr 上「中文网字计划」@chinese-fonts 按需下载）
- 小赖字体（xiaolai）、悠哉字体（yozai，SIL OFL）、猫啃珠圆体（mkzyt，基于 RocknRoll，OFL）、霞鹜文楷（lxgwwenkai，OFL）
- 千图笔锋手写体（qtbfsxt）：千图网出的，声明免费商用；包里没有正式的授权文件
