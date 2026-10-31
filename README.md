# K3 Starry Deck · 星空甲板

独立的 Three.js 互动场景：星空帆船、旅人与白猫、魔法和形态切换。

## 在线体验

[打开星空甲板](https://lucifer-d3g5l3wro6eec3ca4-1506797949.tcloudbaseapp.com/starry-deck/)

当前使用腾讯云测试域名，首次访问可能显示平台提示，点击“确定访问”进入。体验需要支持 WebGL 的浏览器。

## 运行

安装 Node.js，然后执行 `npm start`，打开 http://127.0.0.1:7419/ 。已附构建产物，体验无需安装依赖。

## 开发

`npm install` 安装构建依赖；`npm test` 检查跳跃落地和边界；`npm run build` 重建网页。

## 操作

WASD 移动，Shift 奔跑，空格跳跃；鼠标拖动环顾，滚轮缩放。F 挥杖，1 冲刺，2 魔法阵，3 玫瑰，4 大阵（再次点击收回），5 切换形态，H 查看说明。

## 部署

将 `site/` 内容部署到静态网站根目录或独立子目录。无需后端、数据库或密钥。

## 范围与许可

仅提供主甲板体验，不包含原书房正文或其他区域入口。原创代码采用 MIT；第三方 Three.js 许可见 `site/THIRD-PARTY-LICENSES.txt`。保留第三方原有许可。
