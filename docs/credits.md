# 来源记录（发布前看这里）

代码里不写「借鉴了谁」，都记在这个文件。以后加了别人的代码、字体、图片，或照着别人的项目做了什么，都往这里添一条。

## 一、照搬进来的代码（发布时必须标注）

（现在没有照搬进来的代码。以前的 `server-plugin/qrcode.js`（qrcode-generator，MIT）在 v0.8.6 删掉了。）

**装插件时下载的开源库**（不在我们仓库里，`npm install` 时下载；发布时在说明里写一句用到了它）：

| 用在哪 | 是什么 | 许可 |
|---|---|---|
| `server-plugin`（扫码 / 手机号登录、搜歌、歌单、歌词、播放地址…） | NeteaseCloudMusicApi 4.32.0，https://www.npmjs.com/package/NeteaseCloudMusicApi | MIT |

## 二、只参考了思路、代码是自己写的（不强制，标上更礼貌）

| 用在哪 | 参考了什么 | 来源 | 许可 |
|---|---|---|---|
| `server-plugin/index.js`（改用 NeteaseCloudMusicApi 这个主意、二维码用 web 方式） | 作者发的「你自己的音乐源」插件，https://github.com/libertyseeyou/yourownmusicapiforST | MIT | 只参考思路 |
| `server-plugin/index.js`（早先的网易云接口地址、扫码登录的流程） | 哪些网易云接口不用加密就能调、扫码登录各个状态码的意思 | Anko3o/music-mcp-netease，https://github.com/Anko3o/music-mcp-netease | CC BY-NC-SA 4.0（不能商用；**如果以后照搬它的代码**，整个项目也得用同样的许可、不能商用，所以只学思路） |
| 电台（哄睡）页面的 2.5D 画风 | 小红书 Toska 的前端（窗台 / 书桌，three.js，AGPL-3.0） | 只参考画风，不用它的代码和图 |
| 音乐「一起听」 | 头像挨着、外侧耳机线的排法；头像上方白底气泡的样子 | 作者发的网易云「一起听」截图、一张带气泡的截图（来源未知） | 只参考样子，没用它们的图 |

## 三、字体和图片

| 文件 | 是什么 | 来源 / 风险 |
|---|---|---|
| `phone/assets/fonts/SFProDisplay-Bold.woff2` | 苹果 SF Pro Display Bold（锁屏时钟） | 苹果的字体，许可只让在苹果设备上用，**不允许拿去分发**。作者决定放进来、自己承担风险（`design-system.md` 里也记了）。公开发布前最好换成免费可商用的字体 |
| `phone/assets/music/rain-day.webp`、`rain-night.webp` | 下雨天皮肤的背景 | 作者给的图，裁掉了 AI 水印。发布前确认是谁画的、能不能用 |
| `phone/assets/music/together-l.webp`、`together-r.webp` | 一起听的有线耳机 | 作者让 GPT 画的，去掉了黑底、切成两半 |
| `phone/assets/music/cat/*.webp` | 搜索页的 10 张分类卡片 | 作者让豆包 AI 画的一整张图，切开用（图外的「豆包AI生成」水印没带进来）。**「说唱」那张的球鞋上有个像耐克的钩子标志**，公开发布前最好重画这张或把标志修掉 |
| `phone/assets/wallpapers/*`、`phone/assets/fab/*` | 壁纸、悬浮按钮 | 作者给的图（照 `gpt-image-brief*.md` 让画图模型画的）。发布前确认一遍 |

## 四、用到的外部服务（不是代码，写在说明里比较好）

- 搜歌 / 歌词：vkeys（https://api.vkeys.cn）
- 播放链接 / 歌单：Meting（默认 https://api.qijieya.cn/meting/）
- 装了服务器插件后：网易云音乐自己的接口
- 没装插件时解析歌单分享短链接：allorigins（https://api.allorigins.win）、corsproxy.io（https://corsproxy.io）、codetabs（https://api.codetabs.com），挨个试
