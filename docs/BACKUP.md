# 导出、备份和迁移

## 网页导出

设置 → 存储：可以导出自己的 JSON 和 Markdown，含归档笔记、时间、标签和附件清单。**不包含原始图片文件**；Markdown 中的私有图片 URL 仍然需要登录原实例。网页最多导出 10,000 条，更多笔记使用脚本。导出期间暂停编辑。

## 图文便携备份

`backup.py` 使用 Python 标准库，不需要第三方包。先在设置 → 账号 → 访问令牌创建个人访问令牌，并设置适当过期时间。令牌只放在环境变量，使用完成后可撤销。

```bash
# 在自己的终端输入令牌；不会回显，也不把令牌留在命令历史中
read -rsp 'MEMOS_TOKEN: ' MEMOS_TOKEN; echo
export MEMOS_TOKEN
python3 scripts/backup.py backup --url https://notes.example.com --output backups/2026-09-24
unset MEMOS_TOKEN
python3 scripts/backup.py verify --directory backups/2026-09-24
```

Windows PowerShell 可通过安全输入或临时环境变量设置 MEMOS_TOKEN；同样不要把真实令牌写进仓库脚本。普通 http 只允许 localhost/loopback 测试，公网必须 HTTPS。

输出：

```text
2026-09-24/
  manifest.json           # 完整笔记元数据、时间、关联、文件 SHA-256 与大小
  notes/<memo-id>.md      # 可以离线读取的 Markdown，附件使用相对路径
  attachments/<id>.png    # 下载到本地的原始 R2 文件
```

只在所有文件下载、写入并校验成功后发布最终目录。任何附件缺失或失败都会报错，不会生成一个声称完整的备份目录；不覆盖已有备份。

范围是当前用户自己的笔记（含归档和评论笔记）及这些笔记关联的 R2 文件。JSON 保留关系元数据；Markdown 保留每条正文。**不包括账号、密码、系统设置、未关联上传文件，也不抓取正文里其他网站的外链图片。** 这不是整个实例的数据库恢复镜像。

`verify` 检查文件是否存在、大小和 SHA-256 是否一致，能发现文件损坏或遗漏；它不是签名验证，也不是数据库恢复演练。当前未提供自动把 Markdown/manifest 导回实例的恢复命令，迁移时可据此编写导入器或转到其他 Markdown 工具。

## 整站灾备

需要同时备份 D1 数据库和 R2 对象，不能只做其中一项。导出期间暂停修改和定时清理，或制定一致性快照策略。管理员可使用 Wrangler 导出 D1 SQL：

```bash
cd backend
npx wrangler d1 export memos --remote --output /安全备份目录/memos.sql
```

R2 需要通过自己的受限 S3 凭据及兼容工具，按原 object key 复制对象到第二份存储。保留配置和迁移记录，Secret 在密码管理器中独立保管。对备份加密、限制访问并设置保留周期。

灾难恢复应先创建隔离测试实例，将 SQL 导入新 D1、将文件以相同对象键恢复到新私有 R2，再调整绑定、重新设定 Secret 并登录测试。验证数量、标签、时间、图片和权限后才切换域名。仓库测试没有访问你的生产 Cloudflare 账号，不等同完成了生产灾备恢复演练。
