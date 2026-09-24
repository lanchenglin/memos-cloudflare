import { fromJson } from "@bufbuild/protobuf";
import { personalFetch } from "@/lib/personal-api";
import { type Attachment, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { LocalFile } from "../types/attachment";

// Keep successful uploads across save retries. A lost response reuses the same ID;
// the Worker verifies content hash and ownership instead of creating duplicates.
const uploads = new WeakMap<File, { id: string; pending?: Promise<Attachment> }>();
async function upload(file: File): Promise<Attachment> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("文件不能为空，且最大 20 MiB；实际限制以服务器配置为准");
  let entry = uploads.get(file);
  if (!entry) { entry = { id: crypto.randomUUID() }; uploads.set(file, entry); }
  if (entry.pending) return entry.pending;
  entry.pending = (async () => {
    const response = await personalFetch(`/api/attachments/upload?filename=${encodeURIComponent(file.name)}`, {
      method: "POST", body: file,
      headers: { "Content-Type": "application/octet-stream", "X-Upload-ID": entry.id },
    });
    return fromJson(AttachmentSchema, await response.json());
  })();
  try { return await entry.pending; }
  catch (error) { entry.pending = undefined; throw error; }
}

export const uploadService = {
  async uploadFiles(localFiles: LocalFile[]): Promise<Attachment[]> {
    if (localFiles.length > 20) throw new Error("每条笔记最多 20 个附件");
    const attachments: Attachment[] = [];
    for (const {file} of localFiles) attachments.push(await upload(file));
    return attachments;
  },
};
