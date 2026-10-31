# AsterPhone ✦

SillyTavern 小手机插件（设计阶段）。

## 安装到酒馆（预览版）
酒馆 → 扩展 → 安装扩展 → 粘贴 `https://github.com/xxuxin0705/AsterPhone` → 安装。
装好后页面右侧会出现一颗 ✦ 悬浮按钮：点一下打开手机，按住可以拖动位置。目前只有锁屏，解锁后是占位页。

## 文档阅读顺序
1. `docs/design-system.md` —— 设计规范（唯一的法官）
2. `docs/pages-settings-lock.md` —— 设置 + 锁屏页面清单
3. `docs/pages-chat.md` —— 聊天页面清单
4. `docs/gpt-image-brief.md` —— 给画图模型的交接单

设计图放在 `design/`。

## 原型
- `prototype/lockscreen/` —— 锁屏原型：月夜城堡、水中月两套会动的壁纸（各有日间 / 夜间），假指纹解锁、数字密码。用浏览器打开 `index.html` 即可（需要通过本地服务器打开，直接双击可能加载不了壁纸）。
