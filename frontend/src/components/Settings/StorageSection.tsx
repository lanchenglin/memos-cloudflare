import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { personalFetch } from "@/lib/personal-api";

type Overview = { memoCount: number; attachmentCount: number; attachmentBytes: number; inboxCount: number; uploadLimitBytes: number };
type ExportMemo = { name: string; content: string; createTime: string; updateTime: string; tags: string[];
  attachments: {name: string; filename: string; type: string}[] };

export default function StorageSection() {
  const [overview, setOverview] = useState<Overview>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { personalFetch("/api/personal/overview").then(r => r.json()).then(setOverview)
    .catch(e => setStatus(e instanceof Error ? e.message : "读取失败")); }, []);

  async function exportNotes(format: "json" | "md") {
    setBusy(true);
    try {
      const memos: ExportMemo[] = [];
      let after = "0", until: number | undefined;
      do {
        const query = new URLSearchParams({after});
        if (until !== undefined) query.set("until", String(until));
        const page = await (await personalFetch(`/api/personal/export?${query}`)).json() as {
          memos: ExportMemo[]; snapshotMaxId: number; nextCursor: string;
        };
        memos.push(...page.memos);
        until = page.snapshotMaxId;
        after = page.nextCursor;
        setStatus(`已读取 ${memos.length} 条笔记`);
        if (memos.length > 10000) throw new Error("超过网页导出上限，请使用 scripts/backup.py 完整导出");
      } while (after);
      const content = format === "json"
        ? JSON.stringify({schemaVersion: 1, exportedAt: new Date().toISOString(), includesImageBytes: false, memos}, null, 2)
        : memos.map(memo => `# ${memo.name}\n\n创建：${memo.createTime}\n更新：${memo.updateTime}\n\n${memo.content}\n\n` +
          memo.attachments.map(a => {
            const url = `${location.origin}/file/${a.name}/${encodeURIComponent(a.filename)}`;
            const label = a.filename.replace(/[\[\]\\]/g, "_");
            return `${a.type.startsWith("image/") ? "!" : ""}[${label}](${url})`;
          }).join("\n")).join("\n\n---\n\n");
      const url = URL.createObjectURL(new Blob([content], {type: format === "json" ? "application/json" : "text/markdown;charset=utf-8"}));
      const a = document.createElement("a"); a.href = url;
      a.download = `memos-${new Date().toISOString().slice(0,10)}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`已导出 ${memos.length} 条笔记（图片文件需另行备份）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出失败";
      setStatus(message); toast.error(message);
    } finally { setBusy(false); }
  }

  return <section className="space-y-5 p-2">
    <h2 className="text-lg font-medium text-foreground">R2 图片存储与导出</h2>
    <p className="text-sm leading-6">正文、标签、时间存放在 D1；图片和 PDF 文件保存在 Worker 绑定的私有 R2 桶。
      不需要在这里填写 S3 密钥。请勿开启 R2 的公共访问。</p>
    {overview && <dl className="grid grid-cols-2 gap-3 text-sm">
      <dt>我的笔记</dt><dd>{overview.memoCount}</dd>
      <dt>待整理</dt><dd>{overview.inboxCount}</dd>
      <dt>附件</dt><dd>{overview.attachmentCount} 个 / {(overview.attachmentBytes / 1024 / 1024).toFixed(1)} MiB</dd>
      <dt>单文件上限</dt><dd>{overview.uploadLimitBytes / 1024 / 1024} MiB</dd>
    </dl>}
    <div className="flex gap-2 flex-wrap">
      <Button disabled={busy} onClick={() => exportNotes("json")}>导出 JSON</Button>
      <Button variant="outline" disabled={busy} onClick={() => exportNotes("md")}>导出 Markdown</Button>
    </div>
    <p className="text-sm leading-6">网页导出包含文字、时间和附件清单，不含图片文件。Markdown 中的图片链接仍需登录本实例。
      完整图文备份请使用仓库中的 <code>scripts/backup.py</code>；导出期间请暂停编辑。</p>
    <p className="text-sm leading-6">未保存的图片只在当前页面中，刷新前请点击保存。文本草稿会保存在当前浏览器；这不是云端备份。</p>
    <p role="status" className="text-sm text-muted-foreground">{status}</p>
  </section>;
}
