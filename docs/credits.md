# 来源记录（发布前看这里）

代码里不写「借鉴了谁」，都记在这个文件。以后加了别人的代码、字体、图片，或照着别人的项目做了什么，都往这里添一条。

## 一、照搬进来的代码（发布时必须标注）

| 用在哪 | 是什么 | 作者 | 许可 | 要做什么 |
|---|---|---|---|---|
| `server-plugin/qrcode.js` | qrcode-generator 1.4.4（画登录二维码） | Kazuhiko Arase，https://github.com/kazuhikoarase/qrcode-generator | MIT | 文件第一行的版权声明不能删（MIT 要求复制的代码带着它）；发布时把下面的许可全文放进仓库或说明里 |

<details><summary>qrcode-generator 的 MIT 许可全文</summary>

```
MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
</details>

## 二、只参考了思路、代码是自己写的（不强制，标上更礼貌）

| 用在哪 | 参考了什么 | 来源 | 许可 |
|---|---|---|---|
| `server-plugin/index.js`（网易云接口地址、扫码登录的流程） | 哪些网易云接口不用加密就能调、扫码登录各个状态码的意思 | Anko3o/music-mcp-netease，https://github.com/Anko3o/music-mcp-netease | CC BY-NC-SA 4.0（不能商用；**如果以后照搬它的代码**，整个项目也得用同样的许可、不能商用，所以只学思路） |
| 音乐「一起听」 | 头像挨着、外侧耳机线的排法；头像上方白底气泡的样子 | 作者发的网易云「一起听」截图、一张带气泡的截图（来源未知） | 只参考样子，没用它们的图 |

## 三、字体和图片

| 文件 | 是什么 | 来源 / 风险 |
|---|---|---|
| `phone/assets/fonts/SFProDisplay-Bold.woff2` | 苹果 SF Pro Display Bold（锁屏时钟） | 苹果的字体，许可只让在苹果设备上用，**不允许拿去分发**。作者决定放进来、自己承担风险（`design-system.md` 里也记了）。公开发布前最好换成免费可商用的字体 |
| `phone/assets/music/rain-day.webp`、`rain-night.webp` | 下雨天皮肤的背景 | 作者给的图，裁掉了 AI 水印。发布前确认是谁画的、能不能用 |
| `phone/assets/music/together-l.webp`、`together-r.webp` | 一起听的有线耳机 | 作者让 GPT 画的，去掉了黑底、切成两半 |
| `phone/assets/wallpapers/*`、`phone/assets/fab/*` | 壁纸、悬浮按钮 | 作者给的图（照 `gpt-image-brief*.md` 让画图模型画的）。发布前确认一遍 |

## 四、用到的外部服务（不是代码，写在说明里比较好）

- 搜歌 / 歌词：vkeys（https://api.vkeys.cn）
- 播放链接 / 歌单：Meting（默认 https://api.qijieya.cn/meting/）
- 装了服务器插件后：网易云音乐自己的接口
