// 手机「本体」对外的几个按钮。main.js 启动时把真正的函数填进来，各个 App 只认这里，避免互相引用。
export const shell = {
  phone: null,          // .as-phone 元素
  wallpaper: null,      // Wallpaper 实例
  visible: true,        // 手机此刻是否打开着（装在酒馆里时，收起来就是 false）
  openApp: (id, opts) => {},
  preload: id => {},    // 手指一按下图标就先读这个 App 的代码，抬手时少等一会儿
  close: () => {},
  applyLook: () => {},  // 外观、状态栏、字号改了之后刷新
  setNight: (night, originEl) => {},
  lockNow: () => {},
  refreshBadges: () => {},
  sendToParent: msg => {},
};
