// Layout-only browser fixture: synthetic images, no backend, accounts or user data.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import "../src/index.css";

const canvas = document.createElement("canvas");
canvas.width = 720;
canvas.height = 2400;
const ctx = canvas.getContext("2d")!;
for (let i = 0; i < 12; i++) {
  ctx.fillStyle = i % 2 ? "#e2e8f0" : "#fafafa";
  ctx.fillRect(0, i * 200, 720, 200);
  ctx.fillStyle = "#172554";
  ctx.font = "36px sans-serif";
  ctx.fillText(`TEST IMAGE - section ${i + 1}`, 20, i * 200 + 70);
}
const picture = canvas.toDataURL("image/png");
function Fixture() {
  const [open, setOpen] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  return (
    <main className="w-full p-4">
      <button onClick={() => setOpen(true)}>Open images</button>
      <button onClick={() => setFormOpen(true)}>Open form</button>
      <PreviewImageDialog
        open={open}
        onOpenChange={setOpen}
        items={[
          { id: "one", kind: "image", sourceUrl: picture, posterUrl: picture, filename: "测试长截图一.png" },
          { id: "two", kind: "image", sourceUrl: picture, posterUrl: picture, filename: "测试长截图二.png" },
        ]}
      />
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogTitle>Mobile form fixture</DialogTitle>
          <DialogDescription>Synthetic mobile layout test, no account data.</DialogDescription>
          {Array.from({ length: 8 }, (_, i) => (
            <label key={i}>
              Test field {i}
              <Input />
            </label>
          ))}
          <button onClick={() => setFormOpen(false)}>Save fixture</button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
