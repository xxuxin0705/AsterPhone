# AsterPhone 酒馆服务器插件（可选，只有本地酒馆能装）

装了以后，小手机的音乐会通过它去连网易云：登录后会员歌也能放，红心同步到网易云，「我的」里多出每日推荐和你网易云里的歌单。不装也能用，照旧走公共音源；Tauri Tavern 装不了，也照旧。

## 安装（一次）
1. 把这个 `server-plugin` 文件夹复制到 `SillyTavern/plugins/` 下面，改名叫 `asterphone`。
2. 打开 `SillyTavern/config.yaml`，把 `enableServerPlugins: false` 改成 `true`。
3. 重启酒馆。

## 登录
小手机 → 音乐 → 我的 → 「登录网易云」：用网易云 App 扫二维码。
在手机上没法扫自己的屏幕时，用电脑打开酒馆扫一次就行，登录是记在酒馆这边的，哪台设备打开都算登录了。

登录凭证（MUSIC_U，等于网易云的密码）只存在这个文件夹的 `.netease_cred` 里，只发给网易云。不要把这个文件发给别人。
