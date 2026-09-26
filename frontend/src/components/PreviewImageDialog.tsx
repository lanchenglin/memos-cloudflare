import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import MotionPhotoPreview from "@/components/MotionPhotoPreview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { MAX_IMAGE_ZOOM, MIN_IMAGE_ZOOM, useImagePreviewGestures } from "@/hooks/useImagePreviewGestures";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { PreviewMediaItem } from "@/utils/media-item";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imgUrls?: string[];
  items?: PreviewMediaItem[];
  initialIndex?: number;
}

function PreviewImageDialog({ open, onOpenChange, imgUrls = [], items, initialIndex = 0 }: Props) {
  const sm = useMediaQuery("sm");
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const previewItems = useMemo(
    () => items ?? imgUrls.map((url) => ({ id: url, kind: "image" as const, sourceUrl: url, posterUrl: url, filename: "Image" })),
    [imgUrls, items],
  );
  const count = previewItems.length;
  const safeIndex = Math.max(0, Math.min(currentIndex, count - 1));
  const item = previewItems[safeIndex];
  const multiple = count > 1;
  const isImage = item?.kind === "image";
  const previous = () => setCurrentIndex((index) => Math.max(index - 1, 0));
  const next = () => setCurrentIndex((index) => Math.min(index + 1, count - 1));
  const gestures = useImagePreviewGestures({ open, itemId: item?.id, enabled: isImage, onPrevious: previous, onNext: next });
  const { view } = gestures;

  useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [open, initialIndex]);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
      if (event.key === "ArrowLeft") setCurrentIndex((index) => Math.max(index - 1, 0));
      if (event.key === "ArrowRight") setCurrentIndex((index) => Math.min(index + 1, count - 1));
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, count, onOpenChange]);

  if (!count || !item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden rounded-none border-0 bg-black/92 p-0 shadow-none [&>div:first-child]:min-h-0 [&>div:first-child]:gap-0 [&>div:first-child]:overflow-hidden"
        style={{
          top: 0,
          left: 0,
          width: "100%",
          maxWidth: "100%",
          height: "100dvh",
          maxHeight: "100dvh",
          translate: "none",
          transform: "none",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <VisuallyHidden>
          <DialogTitle>{item.filename || "Attachment preview"}</DialogTitle>
          <DialogDescription>
            Attachment preview. Escape closes; arrow keys switch items. Pinch or double tap to zoom, drag to inspect a zoomed image, or
            swipe at 100% to switch images.
          </DialogDescription>
        </VisuallyHidden>

        <header
          className="z-20 flex shrink-0 items-start justify-between gap-3 px-3 pb-2 text-white sm:px-5"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" }}
        >
          <div className="min-w-0 pt-2">
            <div className="truncate text-sm font-medium">{item.filename || "Attachment"}</div>
            {multiple && (
              <div className="mt-1 text-xs text-white/70">
                {safeIndex + 1} / {count}
              </div>
            )}
          </div>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full bg-white/10 text-white hover:bg-white/16 hover:text-white"
            aria-label="Close preview"
            title="关闭预览"
          >
            <X className="h-5 w-5" />
          </Button>
        </header>

        <div
          ref={gestures.stageRef}
          data-testid={isImage ? "preview-zoom-surface" : undefined}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden overscroll-contain",
            isImage && (view.scale > 1 ? (gestures.dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"),
          )}
          style={{ touchAction: isImage ? "none" : "auto" }}
          {...gestures.handlers}
          onDoubleClick={gestures.onDoubleClick}
        >
          {item.kind === "video" ? (
            <video
              key={item.id}
              src={item.sourceUrl}
              poster={item.posterUrl}
              className="max-h-full max-w-full object-contain"
              controls
              autoPlay
              playsInline
            />
          ) : item.kind === "motion" ? (
            <MotionPhotoPreview
              key={item.id}
              posterUrl={item.posterUrl}
              motionUrl={item.motionUrl}
              alt={`Preview live photo ${safeIndex + 1} of ${count}`}
              presentationTimestampUs={item.presentationTimestampUs}
              containerClassName="flex h-full w-full items-center justify-center"
              mediaClassName="max-h-full max-w-full object-contain"
            />
          ) : (
            <img
              ref={gestures.imageRef}
              src={item.sourceUrl}
              alt={`Preview image ${safeIndex + 1} of ${count}`}
              className="max-h-full max-w-full object-contain select-none"
              style={{
                transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
                transformOrigin: "center center",
                transition: gestures.dragging ? "none" : "transform 120ms ease-out",
              }}
              onLoad={gestures.onImageLoad}
              draggable={false}
              loading="eager"
              decoding="async"
            />
          )}
        </div>

        <footer
          className="z-30 flex shrink-0 flex-col items-center gap-1 px-2 pt-2 sm:px-5"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
        >
          {/* Separate navigation from zoom controls on phones: even 320px screens fit. */}
          {multiple && !sm && (
            <div className="flex max-w-full items-center justify-center gap-2 rounded-full bg-black/60 px-2 text-white">
              <PreviewButton label="Previous item" title="上一张" onClick={previous} disabled={safeIndex === 0}>
                <ChevronLeft className="h-5 w-5" />
              </PreviewButton>
              <span className="min-w-12 text-center text-xs tabular-nums">
                {safeIndex + 1}/{count}
              </span>
              <PreviewButton label="Next item" title="下一张" onClick={next} disabled={safeIndex === count - 1}>
                <ChevronRight className="h-5 w-5" />
              </PreviewButton>
            </div>
          )}
          {isImage && (
            <div className="flex max-w-full items-center justify-center gap-1 rounded-full bg-black/60 px-2 py-1 text-white">
              <PreviewButton label="Zoom out" title="缩小" onClick={gestures.zoomOut} disabled={view.scale === MIN_IMAGE_ZOOM}>
                <ZoomOut className="h-5 w-5" />
              </PreviewButton>
              <span className="min-w-12 text-center text-xs tabular-nums">{Math.round(view.scale * 100)}%</span>
              <PreviewButton label="Zoom in" title="放大" onClick={gestures.zoomIn} disabled={view.scale === MAX_IMAGE_ZOOM}>
                <ZoomIn className="h-5 w-5" />
              </PreviewButton>
              <PreviewButton label="Reset zoom" title="重置缩放" onClick={gestures.reset} disabled={view.scale === MIN_IMAGE_ZOOM}>
                <RotateCcw className="h-5 w-5" />
              </PreviewButton>
            </div>
          )}
        </footer>

        {multiple && sm && (
          <>
            <NavButton side="left" label="Previous item" disabled={safeIndex === 0} onClick={previous}>
              <ChevronLeft className="h-5 w-5" />
            </NavButton>
            <NavButton side="right" label="Next item" disabled={safeIndex === count - 1} onClick={next}>
              <ChevronRight className="h-5 w-5" />
            </NavButton>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewButton({
  label,
  title,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={title}
      className="h-11 w-11 shrink-0 rounded-full text-white hover:bg-white/12 hover:text-white disabled:text-white/35"
    >
      {children}
    </Button>
  );
}

function NavButton({
  side,
  label,
  disabled,
  onClick,
  children,
}: {
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/16 hover:text-white disabled:opacity-25 sm:flex",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      {children}
    </Button>
  );
}
export default PreviewImageDialog;
