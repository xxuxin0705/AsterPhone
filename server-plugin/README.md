# AsterPhone 酒馆服务器插件（可选，只有本地酒馆能装）

装了以后，小手机的音乐会通过它去连网易云和 QQ 音乐：登录后会员歌也能放，红心同步到网易云，「我的」里多出每日推荐和你网易云 / QQ 里的歌单。不装也能用，照旧走公共音源；Tauri Tavern 装不了，也照旧。

## 安装（一次）
**Termux**：复制这一整行进去回车，看到「装好了」后重启酒馆。以后插件更新了，再跑一遍就行（登录不会掉）。

```
cd ~/SillyTavern && mkdir -p plugins/asterphone && cd plugins/asterphone && for f in index.js package.json; do curl -fsSL https://raw.githubusercontent.com/xxuxin0705/AsterPhone/main/server-plugin/$f -o $f || exit 1; done && rm -f qrcode.js && npm install --omit=dev --no-audit --no-fund && cd ~/SillyTavern && sed -i "s/enableServerPlugins: false/enableServerPlugins: true/" config.yaml && echo 装好了，重启酒馆就行
```
（会下载连网易云、QQ 音乐用的两个开源库，第一次要等一两分钟。）

**电脑上手动装**：
1. 把这个 `server-plugin` 文件夹复制到 `SillyTavern/plugins/` 下面，改名叫 `asterphone`，在里面运行 `npm install --omit=dev`。
2. 打开 `SillyTavern/config.yaml`，把 `enableServerPlugins: false` 改成 `true`。
3. 重启酒馆。

## 登录
小手机 → 音乐 → 我的 → 「登录网易云」：用网易云 App 扫二维码，或者点「手机号登录」收短信验证码；「登录 QQ 音乐」：用手机 QQ 扫二维码。
在手机上没法扫自己的屏幕时，用电脑打开酒馆扫一次就行，登录是记在酒馆这边的，哪台设备打开都算登录了。

登录凭证（等于网易云 / QQ 的密码）只存在这个文件夹的 `.netease_cred` / `.qq_cred` 里，只发给网易云 / QQ。不要把这两个文件发给别人。
