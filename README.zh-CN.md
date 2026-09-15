# Monash Attendance Helper

[English](README.md) | **简体中文**

> 当前扩展版本：**v1.3.23**
>
> v1.3.23 重点修复“已签到课程在扫描后消失”的回归：已完成的 Attendance 记录现在会从第一阶段发现一直保留到最终核对；用于发现已完成课程的合成链接会和真正可填写的 `Entry.aspx` 链接严格区分，不会进入提交路径；扩展重新加载后也会修复已经打开的 Attendance 标签页。另外，设置页的“保存后立即测试”现在会等待最终核对完成后再显示统计结果。

一个可配置的 Chrome 扩展，用于从 **Monash Attendance** 发现近期课程，从 **Gmail、Ed Discussion 和 Moodle** 中查找对应签到码，在提交前让学生逐条确认，并识别已经完成签到的课程。

默认模式**不需要手动填写课表**。扩展会读取当前 Chrome Profile 已登录的 Monash Attendance 中最近若干天的课程活动，再依次从已经登录的 Gmail、Ed 和 Moodle 页面中寻找对应签到码。手动课表仍然保留，作为自动发现失败时的备用方式。

> **重要：** 本项目不是无人值守的自动签到机器人。扩展只会准备待确认记录；真正提交前，学生必须确认自己实际参加了课程，并主动勾选声明和要提交的记录。

## 功能

1. 从当前 Chrome Profile 已登录的 Monash Attendance 读取近期课程，包括课程代码、活动类型、班次、时间和日期。
2. 已经在 Attendance 中显示完成的课程仍会保留在确认页，并显示为 **“已签到 / 已完成”**，不会再次提交。
3. 按以下思路寻找签到码：
   - **Gmail**：搜索 Attendance 相关邮件，并尽量使用最新结果；
   - **Ed Discussion**：进入对应课程，优先检查近期 Attendance / Attendance Code 帖子；
   - **Moodle**：如果前两者没有可靠结果，则进入对应 Moodle 课程及近期 Week 页面，并继续跟踪 Attendance activity / Attendance Codes 页面。
4. 对文字表格直接解析；对 Ed 等页面中的签到表截图，可在扩展本地运行 OCR。
5. 使用课程、活动类型、班号、日期和时间进行匹配，降低把另一门课或另一个班次的代码误配过来的风险。
6. 只把高可信结果默认勾选；不确定结果会保留为 **“请核对”** 或 **“未找到”**。
7. 在设定的提醒时间发送 Chrome 系统通知，也可以从设置页手动立即测试。
8. 只有在确认页面勾选本人出席声明后，才允许提交所选记录到 Monash Attendance；已经完成的记录不会进入提交列表。

提醒时间使用**运行 Chrome 的电脑当前系统时区**，并不是固定为马来西亚时区。

## 默认自动发现流程

建议让以下网站保持登录在**同一个 Chrome Profile** 中：

- Monash Attendance
- Monash Moodle
- Gmail
- Ed Discussion（如果你的课程使用 Ed）

保持 **Automatically discover classes from Attendance / 自动从 Attendance 发现课程** 开启后，不需要填写 Week 1 日期，也不需要预先维护完整课表。

当前自动流程大致为：

```text
Monash Attendance
  ↓
发现最近课程 + 保留已签到课程
  ↓
Gmail
  ↓ 没有可靠代码
Ed Discussion
  ↓ 仍没有可靠代码
Moodle
  ↓
最终按 日期 + 课程 + 活动类型 + 班号 + 时间 核对
  ↓
重新读取 Attendance 完成状态
  ↓
确认页面
  ↓
学生本人确认后才提交未完成记录
```

已经完成的课程会使用“日期 + 课程 + 活动类型 + 班号 + 时间”的独立身份保存，因此同一天有多节已签到课程时不会互相覆盖。用于第一阶段发现的合成链接带有 `mah_completed=1` 标记；最终核对会把它识别为“已完成证据”，而不是可填写的真实 Attendance 入口。真正存在的 `Entry.aspx` 链接仍按“待填写课程”处理。

### Moodle 的查找方式

Moodle 不只是读取 `My units` 首页。扩展会尝试：

1. 找到目标课程，例如 `TRC2001`；
2. 进入课程主页；
3. 检查近期 Week / section 页面；
4. 查找名称或上下文中包含 `Attendance` 的 activity；
5. 继续打开 Attendance 页面，并解析类似 `Workshop / Laboratory / Tutorial + Date + Time + Code` 的结构化记录。

如果课程 URL 已经在前面的扫描中被发现，最终核对会优先直接读取这些已知页面，不会因为 `My units` 页面长时间保持 `loading` 而阻塞整个流程。

## 已签到课程

扩展不会只显示“还没填 Attendance”的课程。

如果 Monash Attendance 已经把某一节课标记为完成，例如页面上出现绿色勾选，确认页仍应显示这门课，并标记为：

```text
已签到
✓ 已完成
```

这种记录不能再次勾选或重复提交。这样可以更清楚地区分：

- 已经签到完成；
- 找到签到码、等待确认；
- 找到候选但需要人工核对；
- 完全没有找到签到码。

## 安装

1. 下载或克隆本仓库。
2. 打开 Chrome：`chrome://extensions`。
3. 开启右上角 **开发者模式 / Developer mode**。
4. 点击 **加载未打包的扩展程序 / Load unpacked**。
5. 选择仓库中的 `extension` 文件夹。
6. 建议把 **Monash Attendance Helper** 固定到工具栏。
7. 打开扩展设置页。
8. 保持自动 Attendance 发现开启，并设置主要提醒时间和可选备用提醒时间。
9. 确保 Gmail、Moodle、Ed 和 Monash Attendance 在同一个 Chrome Profile 中保持登录。
10. 点击 **保存后立即测试**。v1.3.23 会先完成普通扫描，再执行最终 Attendance 核对，完成后才显示最终统计。

更新本地代码后，需要回到 `chrome://extensions` 对扩展点击**重新加载**。确认扩展卡片显示的版本号与 `extension/manifest.json` 一致。

## 手动课表模式（备用）

如果你不想使用自动发现，也可以为课程手动配置：

- **Course code / name**：例如 `FIT2102`；
- **Source**：Moodle 或 Ed Discussion；
- **Source URL**：对应 Moodle / Ed 页面；
- **Ed category**：可选，例如 `Malaysia`；
- **Class groups**：添加你实际参加的 Tutorial、Workshop、Laboratory、Studio、Applied、Seminar 等活动，并填写星期和开始时间。

仓库中**没有默认绑定 FIT3162 / FIT2102 / FIT2109 的个人课表**。开发者自己的旧课表只应作为示例数据存在于 `examples/` 中，其他学生必须使用自己的课程信息。

## Web 配置器

`site/` 中包含图形化配置页面，可生成：

```text
attendance-helper-config.json
```

然后在扩展设置页中通过 **Import web config** 导入。

示例文件：

```text
examples/mum-2026-s2-example.json
```

它只用于展示配置格式，**不要假设里面的课程 URL、班次、日期或提醒时间适用于你本人**。

## 隐私与安全

扩展不会把以下内容上传到本项目网站或仓库：

- Monash / Gmail 密码；
- 登录 Cookie；
- 邮件正文；
- Moodle / Ed 页面内容；
- Attendance code；
- 个人课表。

OCR 在扩展本地运行。Tesseract worker、WebAssembly core 和英文识别模型随扩展一起打包，不需要把截图发送到第三方 OCR 服务。

扩展使用 Chrome Manifest V3。OCR worker 从扩展本地资源加载；浏览器可读取的图片会先在本地标准化后再交给 OCR。Ed 页面中的临时 `blob:` 图片会在来源页面仍然打开时进行本地快照。

## 为什么不会直接自动提交

签到码本身不能证明学生真实参加了课程，因此项目刻意保留人工确认步骤：

- 高可信代码可以默认勾选，但仍需要学生本人确认；
- `请核对` 的结果不会默认选中；
- 已完成课程不会重复提交；
- 没有码或匹配不确定时不会猜测一个代码；
- 每次提交前都要重新勾选出席声明。

## 主要限制

- 每个 Chrome Profile 都需要单独安装和登录。
- 定时提醒依赖电脑和 Chrome 能够运行；如果登录失效，仍需要人工重新登录。
- Gmail、Ed、Moodle 和 Attendance 都可能修改页面结构，页面结构变化可能导致自动解析失效。
- 某些 Monash 页面即使内容已经显示，Chrome 仍可能长期显示 `loading`。最终核对会直接读取已经可用的 DOM，而不是强制等待 `complete`；如果页面本身确实没有加载出内容，仍可能失败。
- Moodle / Ed 中同一时间可能存在多个班次，因此班号缺失时扩展会优先保持不确定，而不是冒险匹配。
- OCR 结果可能出错。任何标记为 **请核对** 的代码都应回到来源页面人工确认。
- 课程教学团队可以随时改变 Attendance code 的发布方式，本项目无法保证对所有课程永久有效。

## 开发与测试

运行扩展解析与回归测试：

```sh
node --test tests/*.test.mjs
```

运行网站测试和 lint：

```sh
cd site
npm ci
npm test
npm run lint
```

Pull Request 也会通过 GitHub Actions 自动运行相关检查。

当前测试覆盖包括但不限于：

- Gmail 多账号与邮件候选排序；
- 不同 Week / 日期之间的代码隔离；
- 相同时间不同班号的匹配保护；
- Ed 多行签到表和 OCR 回归；
- Moodle Attendance 表格解析；
- TRC2001 `Workshop 02` / `Laboratory 03` 这类结构化记录匹配；
- 已签到 Attendance 记录保留；
- 同一天多条已签到记录不会被去重为一条；
- 合成 completed 链接与真实待填写 `Entry.aspx` 链接的区分；
- 已签到记录不会重新进入提交列表；
- 设置页测试流程必须执行最终核对；
- 最终核对模块及相关运行时代码的 JavaScript 语法检查。

## 项目结构

```text
extension/   Chrome 扩展主体
site/        Web 配置器
examples/    示例配置
scripts/     辅助脚本
tests/       自动化与回归测试
```

## 免责声明

这是一个学生个人开发的辅助工具，不是 Monash University 官方产品，也不代表学校、学院或课程教学团队。

请遵守 Monash 的出勤、学术诚信和 IT 使用规定。只有在你真实参加相应课程时才应提交签到记录。

## License

MIT
