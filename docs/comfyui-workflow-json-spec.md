# ComfyUI Workflow JSON Specification v1.0

来源：https://docs.comfy.org/specs/workflow_json
存档日期：2026-04-19

---

## 核心结构

```json
{
  "version": 1,
  "config": { "links_ontop": false, "align_to_grid": false },
  "state": { "lastGroupid": 1, "lastNodeId": 2, "lastLinkId": 3, "lastRerouteId": 0 },
  "groups": [],
  "nodes": [],
  "links": [],
  "reroutes": [],
  "extra": {}
}
```

## Node 结构

```json
{
  "id": 1,                          // integer 或 string
  "type": "KSampler",               // 节点类型
  "pos": { "0": 100, "1": 200 },    // 或数组 [100, 200]
  "size": { "0": 300, "1": 400 },   // 或数组 [300, 400]
  "flags": { "collapsed": false },
  "order": 0,
  "mode": 0,
  "inputs": [
    {
      "name": "model",
      "type": "MODEL",              // string | string[] | number
      "link": 1,                    // 或 null
      "slot_index": 0
    }
  ],
  "outputs": [
    {
      "name": "MODEL",
      "type": "MODEL",
      "links": [2],
      "slot_index": 0
    }
  ],
  "properties": {
    "Node name for S&R": "KSampler"
  },
  "widgets_values": [               // 数组 或 对象
    42,                             // seed
    20,                             // steps
    8.0,                            // cfg
    "euler",                        // sampler_name
    "normal",                       // scheduler
    1
  ],
  "color": "#333",
  "bgcolor": "#444"
}
```

## Link 结构

```json
{
  "id": 1,
  "origin_id": 1,
  "origin_slot": 0,
  "target_id": 2,
  "target_slot": 0,
  "type": "MODEL",
  "parentId": null
}
```

## 关键要点

### 1. widgets_values 格式
- **可以是数组**：按索引对应 widget
- **可以是对象**：按 key 对应 widget 名称
- 我们目前只处理数组格式，需要适配对象格式

### 2. slot_index
- inputs/outputs 都有 `slot_index` 字段
- 可用来精确定位 widget 对应的 input 连接
- 比单纯按数组索引推算更可靠

### 3. 节点 ID
- 可以是 integer 或 string
- 我们统一当 string 处理（模板字符串键）

### 4. type 字段
- 可以是 string（如 `"MODEL"`）
- 可以是 string[]（多类型，如 `["IMAGE", "MASK"]`）
- 可以是 number（特殊类型）

### 5. pos/size 格式
- 可以是对象 `{ "0": x, "1": y }`
- 可以是数组 `[x, y]`
- 坐标是画布位置，与 API 格式无关

## 与 API 格式的映射关系

API 格式 (`graphToPrompt()` 输出)：
```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["1", 0],
      "positive": ["6", 0],
      "steps": 20
    },
    "_meta": { "title": "KSampler" }
  }
}
```

映射规则：
- API `class_type` = Node `type`
- API inputs 中数组值 `["nodeId", slot]` = Node inputs 的 link 引用
- API inputs 中原始值 = Node widgets_values 对应项
- API key = Node id（字符串）

---

## 参考

- 官方文档：https://docs.comfy.org/specs/workflow_json
- RFC 仓库：https://github.com/comfy-org/rfcs
- JSON Schema：https://json-schema.org/
