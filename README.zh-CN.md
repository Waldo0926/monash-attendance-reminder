# Monash Attendance Helper

[![类型](https://img.shields.io/badge/%E7%B1%BB%E5%9E%8B-Chrome_%E6%89%A9%E5%B1%95-2563eb?style=for-the-badge)](#)
[![技术](https://img.shields.io/badge/%E6%8A%80%E6%9C%AF-JavaScript-7c3aed?style=for-the-badge)](#)
[![许可证](https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-%E4%BF%9D%E7%95%99%E6%89%80%E6%9C%89%E6%9D%83%E5%88%A9-dc2626?style=for-the-badge)](#)


[English](README.md) | **简体中文**

一个注重隐私的 Chrome 扩展，帮助 Monash 学生自动发现近期需要处理的考勤活动，从 Gmail、Ed Discussion 和 Moodle 中寻找对应的 Attendance Code，在提交前集中核对，并且只会在学生明确确认后才提交。

默认模式**不需要手动填写完整课表**。扩展会读取当前 Chrome Profile 已登录的 Monash Attendance 中的近期课程活动，同时保留已经完成签到的记录，再从当前已登录的 Monash 学习平台中寻找对应签到码。

> **重要：** 本项目不是无人值守的自动签到机器人。它只负责帮助整理和核对考勤信息；真正提交前，学生必须确认自己确实参加了对应课程。

## 功能

- 自动从 **Monash Attendance** 发现近期课程活动。
- 已经在 Attendance 中显示完成的课程仍会保留，并标记为已完成，而不是直接隐藏。
- 按以下顺序寻找签到码：
  1. **Gmail**：优先检查近期 Attendance 相关邮件；
  2. **Ed Discussion**：如果课程使用 Ed，则检查近期 Attendance / Attendance Code 帖子；
  3. **Moodle**：继续进入对应课程、近期 Week / section 页面以及 Attendance activity 查找。
- 对文字形式的 Attendance 表格直接解析。
- 对以图片形式发布的签到表，可使用扩展内置的本地 OCR。
- 根据可获得的课程代码、活动类型、班号、日期和时间综合匹配签到码。
- 对不确定结果明确标记为需要人工核对，而不是直接猜测。
- 支持自定义 Chrome 提醒时间。
- 提交前必须由学生主动勾选出席声明。
- 保留手动课表模式，作为自动发现失败时的备用方案。

提醒时间使用**运行 Chrome 的电脑当前系统时区**。

## 自动发现流程

建议让以下服务保持登录在**同一个 Chrome Profile** 中：

- Monash Attendance
- Gmail
- Monash Moodle
- Ed Discussion（如果你的课程使用 Ed）

扩展的大致查找流程如下：

```text
Monash Attendance
  ↓
发现近期课程 + 判断是否已经完成签到
  ↓
Gmail
  ↓ 未解决
Ed Discussion
  ↓ 未解决
Moodle
  ↓
根据课程 / 活动 / 班号 / 日期 / 时间进行匹配
  ↓
确认页面
  ↓
学生本人确认后才提交
```

### Moodle 回退查找

Moodle 查找不只是停留在 `My units` 页面。

对于仍未找到签到码的课程，扩展可以继续进入对应课程，检查近期 Week / section 页面，并进一步查找 Attendance 相关 activity。

这对于那些只在 Moodle 里面发布 Attendance Code、而不通过 Gmail 或 Ed 发布的课程尤其有用。

## 已完成签到的课程

确认页不应该只显示“还没填 Attendance”的课程。

已经完成的课程仍然会显示在列表中，并标记为已完成，而且不能再次提交。这样可以清楚区分：

- 已经完成签到；
- 找到高可信签到码、等待核对；
- 找到候选签到码、但需要人工确认；
- 完全没有找到签到码。

## Chrome 安装方法

1. 下载或克隆本仓库。
2. 打开 `chrome://extensions`。
3. 开启右上角的 **开发者模式 / Developer mode**。
4. 点击 **加载未打包的扩展程序 / Load unpacked**。
5. 选择仓库中的 `extension` 文件夹。
6. 如有需要，把 **Monash Attendance Helper** 固定到工具栏。
7. 打开扩展设置页面。
8. 保持自动 Attendance 发现开启，并设置主要提醒时间和可选备用提醒时间。
9. 确保 Gmail、Moodle、Ed 和 Monash Attendance 在同一个 Chrome Profile 中保持登录。
10. 保存设置后，使用测试 / 重新查找功能检查识别到的课程和签到码。

本地更新代码后，需要回到 `chrome://extensions` 对未打包扩展点击**重新加载**。

## 手动课表模式（备用）

自动发现是推荐模式，但项目仍然保留手动课表作为备用方案。

手动课程配置可以包括：

- 课程代码或课程名；
- Moodle 或 Ed 的来源 URL；
- 可选的 Ed category；
- 你实际参加的 Tutorial、Workshop、Laboratory、Studio、Applied、Seminar 或其他活动；
- 每个活动对应的星期和开始时间。

仓库**不会提供一份要求其他学生直接使用的个人课表**。`examples/` 目录中的配置只用于展示格式，不能假设适用于其他学生。

## Web 配置器

`site/` 目录包含一个图形化配置页面，可以生成：

```text
attendance-helper-config.json
```

生成的文件可以从扩展设置页导入。

## 隐私与安全

扩展不会把以下内容上传到本项目仓库或网站：

- Monash 或 Gmail 密码；
- 登录 Cookie；
- 邮件正文；
- Moodle 或 Ed 页面内容；
- Attendance Code；
- 个人课表数据。

OCR 在扩展本地运行。OCR worker、WebAssembly core 和英文识别模型都随扩展一起打包，不需要把签到表截图发送给第三方 OCR 服务。

## 为什么保留人工确认

Attendance Code 本身不能证明学生真实参加了课程，因此项目刻意保留人工确认步骤：

- 高可信结果可以直接准备到确认页面；
- 不确定结果会明确标记；
- 已完成课程不会重复提交；
- 没有码或匹配不明确时不会随意猜测；
- 提交前必须由学生主动确认出席声明。

## 主要限制

- 每个 Chrome Profile 都需要单独配置。
- Gmail、Moodle、Ed 和 Monash Attendance 的页面结构以后都可能变化。
- 如果登录状态已经过期，仍然需要学生重新登录。
- OCR 可能识别错误，因此被标记为需要核对的图片结果应人工确认。
- 不同课程可能使用完全不同的签到码发布方式。
- 本项目无法保证永久兼容所有课程和未来所有 Monash 页面布局。

## 开发与测试

运行扩展解析与回归测试：

```sh
node --test tests/*.test.mjs
```

运行 Web 配置器测试和 lint：

```sh
cd site
npm ci
npm test
npm run lint
```

Pull Request 也会通过 GitHub Actions 自动运行相关检查。

## 项目结构

```text
extension/   Chrome 扩展主体
site/        Web 配置器
examples/    示例配置
scripts/     辅助脚本
tests/       自动化与回归测试
```

## 免责声明

这是一个学生个人开发的辅助工具，**不是 Monash University 官方产品**，也不由 Monash University、学院或课程教学团队运营。

请遵守 Monash 的出勤、学术诚信和 IT 使用规定。只有在你真实参加相应课程时才应提交签到记录。

## License

保留所有权利，本仓库不开放复用、二次分发或修改。

欢迎阅读代码作为参考，但请不要 fork 之后删掉人工确认这一步，把它改成自动提交工具，这样做违背了这个项目本身想强调的学术诚信原则。如果你想做类似的东西，建议自己重新实现，并且保留真正需要学生确认才能提交的步骤。

使用这个扩展的风险由使用者自行承担，请遵守 Monash 的出勤、学术诚信与 IT 相关政策。
