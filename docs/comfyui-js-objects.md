# ComfyUI JavaScript Objects & Hijacking

来源：https://docs.comfy.org/custom-nodes/js/javascript_objects_and_hijacking
存档日期：2026-04-19

---

## 核心对象

### ComfyApp (`app`)

应用主对象，通过 `import { app } from "../../scripts/app.js"` 获取。

| 属性 | 说明 |
|------|------|
| `canvas` | LGraphCanvas 对象，当前 UI（含 `node_over`, `selected_nodes`） |
| `canvasEl` | DOM `<canvas>` 元素 |
| `graph` | LGraph 对象，当前工作流逻辑状态 |
| `runningNodeId` | 执行中的节点 ID |
| `ui` | UI 元素（queue, menu, dialogs） |

| 函数 | 说明 |
|------|------|
| `graphToPrompt()` | 将工作流转为可提交给 Python 服务器的 prompt |
| `loadGraphData()` | 加载工作流 |
| `queuePrompt()` | 提交 prompt 到队列 |
| `registerExtension()` | 注册扩展 |

> ⚠️ **Hijacking/monkey-patching 已废弃**，应使用官方 extension hooks

---

### LGraph (`graph`)

LiteGraph 框架的一部分，代表工作流的逻辑状态（nodes 和 links）。

```javascript
// 通过 ID 获取节点
const node = app.graph._nodes_by_id(my_node_id);

// 遍历输入连接
node.inputs.forEach(input => {
  const link_id = input.link;
  if (link_id) {
    const link = app.graph.links[link_id];
    const upstream_id = link.origin_id;
  }
});
```

---

### LLink

代表一个连接，从 `origin_id.origin_slot` → `target_id.target_slot`。

| 属性 | 说明 |
|------|------|
| `id` | 连接 ID |
| `origin_id` | 源节点 ID |
| `origin_slot` | 源节点输出槽位 |
| `target_id` | 目标节点 ID |
| `target_slot` | 目标节点输入槽位 |
| `type` | 数据类型字符串 |

---

### ComfyNode

代表工作流中的一个节点，是 LGraphNode 的子类。

#### 属性

| 属性 | 说明 |
|------|------|
| `id` | 唯一 ID |
| `type` | 节点类型（Python class name） |
| `comfyClass` | 代表该节点的 Python 类 |
| `title` | 显示标题 |
| `pos` | 画布 [x,y] 位置 |
| `size` | 节点宽高 |
| `mode` | 0=正常, 2=静音, 4=跳过 |
| `order` | 执行顺序位置 |
| `inputs` | 输入列表（左侧圆点） |
| `outputs` | 输出列表 |
| `widgets` | 控件列表 |
| `widgets_values` | 控件当前值列表 |
| `properties` | 含 `"Node name for S&R"` |
| `flags` | 状态标志（`flags.collapsed`） |
| `bgcolor` | 背景色 |
| `graph` | LGraph 引用 |
| `input_type` | 输入类型列表 |
| `properties_info` | properties 的类型和默认值 |

#### 重要函数

**输入/输出/控件：**

| 函数 | 说明 |
|------|------|
| `addInput(name, type)` | 创建新输入 |
| `addInputs(inputs)` | 批量创建 |
| `findInputSlot(name)` | 按名称查找槽位索引 |
| `findInputSlotByType(type)` | 按类型匹配 |
| `removeInput(slot)` | 按索引删除 |
| `getInputNode(slot)` | 获取连接的节点 |
| `getInputLink(slot)` | 获取 LLink 对象 |
| `getOutputNodes(slot)` | 获取下游节点列表 |
| `addWidget(type, name, value, ...)` | 添加标准控件 |
| `addCustomWidget(config)` | 添加自定义控件 |
| `addDOMWidget(name, elem)` | 添加 DOM 元素控件 |
| `convertWidgetToInput(slot)` | 控件转输入 |

**连接：**

| 函数 | 说明 |
|------|------|
| `connect(slot, targetNode, targetSlot)` | 连接输出到输入 |
| `connectByType(slot, node, type)` | 按类型连接 |
| `disconnectInput(slot)` | 断开输入 |
| `disconnectOutput(slot, targetNode)` | 断开输出 |
| `onConnectionChange(side)` | 连接变化回调 |
| `onConnectInput(slot, ...)` | 连接前回调（返回 false 拒绝） |

**显示：**

| 函数 | 说明 |
|------|------|
| `setDirtyCanvas(fg, bg)` | 标记需要重绘 |
| `onDrawBackground(ctx)` | 绘制背景 |
| `onDrawForeground(ctx)` | 绘制节点 |
| `getTitle()` | 获取标题 |
| `collapse(toggle)` | 切换折叠状态 |
| `changeMode(mode)` | 切换 bypass/正常 |

---

## Inputs vs Widgets

| | Inputs | Widgets |
|--|--------|---------|
| 位置 | 左侧圆点 | 节点内部控件 |
| 数据源 | 上游节点连接 | 用户手动输入 |
| 可转换 | 部分可转 widget | 可转为 input |

- `node.inputs` — 输入列表，含 `.name`, `.type`, `.link`
- `node.widgets` — 控件列表
- 控件可转为输入，但不是所有输入都能转为控件

---

## 与中转站的关联

### graphToPrompt() 输出与前端对象的关系

| 前端对象 | API 输出对应 |
|----------|-------------|
| `node.id` | API JSON 的 key |
| `node.type` | `class_type` |
| `node.widgets_values` | `inputs` 中的原始值（非连接） |
| `node.inputs[].link` | `inputs` 中的 `["nodeId", slot]` 连接引用 |
| `node.outputs[].links` | 被下游引用的连接 |

### 关键发现

1. **`app.graphToPrompt()`** 就是 API 格式的来源
2. 前端 `LLink` 对象直接包含 `origin_id/origin_slot/target_id/target_slot`
3. 控件值通过 `node.widgets_values` 数组获取
4. 连接信息通过 `app.graph.links` 获取

---

## LiteGraph

ComfyUI 前端基于 [LiteGraph.js](https://github.com/jagenjo/litegraph.js) 构建。

文档在仓库的 `doc/index.html`。开发复杂节点时建议克隆仓库阅读文档。
