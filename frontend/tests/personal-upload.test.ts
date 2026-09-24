import { describe, expect, it, vi } from "vitest";
import { personalFetch } from "@/lib/personal-api";
import { uploadService } from "@/components/MemoEditor/services/uploadService";
import type { LocalFile } from "@/components/MemoEditor/types/attachment";
vi.mock("@/lib/personal-api", () => ({ personalFetch: vi.fn() }));
const localFile = (name: string): LocalFile => ({file:new File([new Uint8Array([137,80,78,71])],name,{type:"image/png"}),previewUrl:"blob:test",origin:"upload"});
const reply = (id = "uploaded") => new Response(JSON.stringify({name:`attachments/${id}`,filename:"截图.png",type:"image/png",size:"4"}),{headers:{"Content-Type":"application/json"}});

describe("native image uploads", () => {
  it("sends the actual File body rather than base64 JSON", async () => {
    const file=localFile("截图.png");
    vi.mocked(personalFetch).mockResolvedValueOnce(reply());
    const result=await uploadService.uploadFiles([file]);
    const [url,options]=vi.mocked(personalFetch).mock.calls[0];
    expect(url).toContain(encodeURIComponent("截图.png"));
    expect(options?.body).toBe(file.file);
    expect(new Headers(options?.headers).get("X-Upload-ID")).toBeTruthy();
    expect(result[0].type).toBe("image/png");
  });
  it("keeps a successful upload when saving again", async () => {
    const file=localFile("already-uploaded.png");
    vi.mocked(personalFetch).mockResolvedValueOnce(reply());
    await uploadService.uploadFiles([file]);
    await uploadService.uploadFiles([file]);
    expect(personalFetch).toHaveBeenCalledTimes(1);
  });
  it("reuses the same upload ID after a network error", async () => {
    const file=localFile("network-retry.png");
    vi.mocked(personalFetch).mockRejectedValueOnce(new Error("network failure")).mockResolvedValueOnce(reply());
    await expect(uploadService.uploadFiles([file])).rejects.toThrow("network failure");
    await uploadService.uploadFiles([file]);
    const calls=vi.mocked(personalFetch).mock.calls;
    expect(new Headers(calls[0][1]?.headers).get("X-Upload-ID")).toBe(new Headers(calls[1][1]?.headers).get("X-Upload-ID"));
  });
  it("does not upload the first file again if the second one failed", async () => {
    const files=[localFile("a.png"),localFile("b.png")];
    vi.mocked(personalFetch).mockResolvedValueOnce(reply("a")).mockRejectedValueOnce(new Error("second failed")).mockResolvedValueOnce(reply("b"));
    await expect(uploadService.uploadFiles(files)).rejects.toThrow("second failed");
    expect(await uploadService.uploadFiles(files)).toHaveLength(2);
    expect(personalFetch).toHaveBeenCalledTimes(3);
  });
  it("rejects more than 20 files before making requests", async () => {
    await expect(uploadService.uploadFiles(Array.from({length:21},(_,i)=>localFile(`${i}.png`)))).rejects.toThrow("20");
    expect(personalFetch).not.toHaveBeenCalled();
  });
});
