# 车迹 · 鸿蒙原生应用

车迹 2.0.0 使用 ArkTS、ArkUI 和 HDS，目标为 HarmonyOS API 26。系统 `EntryAbility` 加载 `pages/Index`。地图和功率曲线使用原生组件，演示数据随应用打包。

## 本地构建

1. 安装 DevEco Studio 及 HarmonyOS API 26 SDK，打开本目录。
2. 修改 `AppScope/app.json5` 中的示例包名和厂商标识。若要覆盖安装自己的旧版，沿用旧版的包名与签名。
3. 在 DevEco Studio 同步 OHPM 依赖，构建 `entry` 模块。真机安装前，在本地生成并配置开发签名。
4. 启动后可浏览演示数据。连接自建 TeslaMate 服务的方法见 [根目录 README](../README.md#连接实车)。

macOS 可在项目根目录运行 `npm run build:hap` 生成未签名 HAP。DevEco Studio 安装在其他位置时，将 `DEVECO_HOME` 指向其 `Contents` 目录。脚本会同步内置演示数据和车辆图片，再调用 OHPM 和 Hvigor。

## 源码入口

| 目录 | 用途 |
| --- | --- |
| `entry/src/main/ets/pages/` | 车况、行程、充电、设置和详情 |
| `entry/src/main/ets/components/` | 行程地图和功率曲线 |
| `entry/src/main/ets/data/` | 服务请求、数据模型、Preferences 与本地费用 |

同一包名与签名下覆盖安装时，原生版沿用旧版的 Preferences 存储格式。连接和手填充电费用保存在当前设备。清除连接会保留已记录的费用。
