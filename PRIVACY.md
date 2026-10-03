# Privacy Policy – Monash Attendance Helper

_Last updated: 4 October 2026_

Monash Attendance Helper is an unofficial Chrome extension for Monash University Malaysia students. It is not affiliated with, endorsed by, or sponsored by Monash University or Google.

## Short version

Everything happens on your own computer. The extension has no server, no account system, no analytics and no advertising. The developer never receives any of your data.

## What the extension reads

While you are signed in to your own accounts, the extension opens pages in background tabs and reads them to find the attendance code for each of your classes:

| Site | What is read |
| --- | --- |
| Monash Attendance (`attendance.monash.edu.my`) | The classes listed for you, and whether each one is already completed |
| Gmail (`mail.google.com`) | Search results and the text and images of messages that match an "attendance" search for your enrolled units |
| Moodle (`learning.monash.edu`) | Your unit pages, week sections, and any Word (.docx) file named like an attendance code |
| Ed (`edstem.org`) | Discussion threads whose titles look like attendance-code posts |
| Moodle file storage (`d25zr1xy094zys.cloudfront.net`) | The signed download link Moodle redirects an attendance .docx file to |

Images (for example a screenshot of a code table pasted into an email, an Ed post, or a Word file) are read with a text-recognition engine (Tesseract) that is bundled inside the extension and runs entirely on your device. No image or text is uploaded for recognition.

## What the extension stores

Settings, the latest scan result, the codes it found, and a diagnostic log are kept in the browser's local extension storage (`chrome.storage.local`) on your computer. The diagnostic log can include short excerpts of the pages and emails that were read, to help find out why a code was missed. You can clear the log from the extension's confirmation page, and removing the extension deletes all stored data.

Nothing is stored in the cloud and nothing is synced.

## What the extension sends

The extension only talks to the sites listed above, using your own signed-in session, to read pages and – only after you tick the confirmation box and press the submit button on the extension's confirmation page – to submit the codes you chose to Monash Attendance. It sends nothing to the developer or to any third party. It does not use analytics, tracking, remote configuration or remotely hosted code.

## Sharing and sale of data

Your data is not sold, not shared with third parties, not used for advertising, and not used for anything other than finding and submitting your own attendance codes. The use of information received from Google services follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Your choices

- Pick which scans run and when from the extension's settings, or run it only by hand.
- Clear the diagnostic log at any time.
- Remove the extension to delete everything it stored.

## Responsibility

The extension finds codes your teaching staff already published to you. It cannot prove that you attended and cannot guarantee a submission succeeds. You are responsible for only submitting codes for classes you actually attended, and for following Monash University's rules.

## Contact

Questions or requests: open an issue at https://github.com/Waldo0926/monash-attendance-reminder/issues

---

# 隐私政策 – Monash Attendance Helper

_最后更新：2026 年 10 月 4 日_

Monash Attendance Helper 是给莫纳什大学马来西亚校区学生用的非官方 Chrome 扩展，与莫纳什大学和 Google 没有任何隶属、认可或赞助关系。

## 简短版本

所有事情都发生在你自己的电脑上。扩展没有服务器，没有账号系统，没有统计，也没有广告。开发者收不到你的任何数据。

## 扩展会读取什么

在你已经登录自己账号的前提下，扩展会在后台标签页里打开并读取页面，为你的每节课找签到码：

| 网站 | 读取的内容 |
| --- | --- |
| Monash Attendance（`attendance.monash.edu.my`） | 你名下的课程，以及每节课是否已经完成 |
| Gmail（`mail.google.com`） | 对你所选课程搜索 "attendance" 得到的结果，以及匹配邮件的文字和图片 |
| Moodle（`learning.monash.edu`） | 你的课程页面、每周版块，以及名字像签到码的 Word（.docx）文件 |
| Ed（`edstem.org`） | 标题看起来像签到码的讨论帖 |
| Moodle 文件存储（`d25zr1xy094zys.cloudfront.net`） | Moodle 把签到码 .docx 文件重定向到的带签名下载链接 |

图片（例如邮件、Ed 帖子或 Word 文件里贴的签到码表格截图）由打包在扩展里的文字识别引擎（Tesseract）识别，完全在你的设备上运行，不会上传任何图片或文字去识别。

## 扩展会保存什么

设置、最近一次扫描结果、找到的签到码和一份诊断日志，都保存在你电脑上浏览器的本地扩展存储（`chrome.storage.local`）里。诊断日志可能包含读取过的页面和邮件的简短片段，用来排查为什么漏了某个签到码。你可以在扩展的确认页里清空日志；卸载扩展会删除所有已保存的数据。

没有任何内容保存在云端，也没有同步。

## 扩展会发送什么

扩展只用你自己的登录状态去访问上面列出的网站来读取页面。只有当你在扩展的确认页里勾选确认框并点击提交后，才会把你选中的签到码提交到 Monash Attendance。它不会向开发者或任何第三方发送任何内容，不使用统计、跟踪、远程配置或远程托管的代码。

## 数据的共享与出售

你的数据不会被出售，不会与第三方共享，不会用于广告，也不会用于查找和提交你自己的签到码之外的任何用途。对来自 Google 服务的信息的使用遵守 Chrome 应用商店用户数据政策，包括其中的"有限使用"要求。

## 你的选择

- 可以在扩展设置里选择扫描何时运行，也可以只手动运行。
- 随时可以清空诊断日志。
- 卸载扩展即可删除它保存的全部内容。

## 责任说明

扩展找到的是教学人员已经发布给你的签到码。它不能证明你到场，也不能保证提交一定成功。你需要自己负责：只为你真正参加过的课程提交签到码，并遵守莫纳什大学的规定。

## 联系方式

有问题或请求，请在 https://github.com/Waldo0926/monash-attendance-reminder/issues 提交 issue。
