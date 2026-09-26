import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";

export const MIN_IMAGE_ZOOM = 1;
export const MAX_IMAGE_ZOOM = 4;
const STEP = 0.2;
type Point = { x: number; y: number };
type View = Point & { scale: number };
const INITIAL: View = { x: 0, y: 0, scale: 1 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Keep a zoomed image inside the stage; no blank space beyond its edges. */
export function constrainImageView(view: View, image: { width: number; height: number }, stage: { width: number; height: number }): View {
  const scale = Math.max(MIN_IMAGE_ZOOM, Math.min(MAX_IMAGE_ZOOM, view.scale));
  const maxX = Math.max(0, (image.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (image.height * scale - stage.height) / 2);
  return { scale, x: Math.max(-maxX, Math.min(maxX, view.x)) || 0, y: Math.max(-maxY, Math.min(maxY, view.y)) || 0 };
}

export function useImagePreviewGestures({
  open,
  itemId,
  enabled,
  onPrevious,
  onNext,
}: {
  open: boolean;
  itemId?: string;
  enabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(INITIAL);
  const [dragging, setDragging] = useState(false);
  const current = useRef<View>(INITIAL);
  const pointers = useRef(new Map<number, Point>());
  const origin = useRef<{ point: Point; view: View; distance: number } | null>(null);
  const gestureStart = useRef<Point | null>(null);
  const pinched = useRef(false);
  const moved = useRef(false);
  const lastTap = useRef<{ point: Point; time: number } | null>(null);
  const lastTouch = useRef(0);

  const apply = useCallback((next: View) => {
    const image = imageRef.current,
      stage = stageRef.current;
    const bounded = constrainImageView(
      next,
      { width: image?.offsetWidth || 0, height: image?.offsetHeight || 0 },
      { width: stage?.clientWidth || 0, height: stage?.clientHeight || 0 },
    );
    current.current = bounded;
    setView(bounded);
  }, []);
  const reset = useCallback(() => apply({ ...INITIAL }), [apply]);
  const changeZoom = (scale: number) => {
    const old = current.current;
    const ratio = Math.max(MIN_IMAGE_ZOOM, Math.min(MAX_IMAGE_ZOOM, scale)) / old.scale;
    apply({ scale, x: old.x * ratio, y: old.y * ratio });
  };

  useEffect(() => {
    pointers.current.clear();
    origin.current = null;
    gestureStart.current = null;
    lastTap.current = null;
    pinched.current = false;
    moved.current = false;
    setDragging(false);
    reset();
  }, [itemId, open, reset]);

  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => apply(current.current));
    if (stageRef.current) observer.observe(stageRef.current);
    if (imageRef.current) observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, [open, itemId, apply]);

  const rebase = () => {
    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      origin.current = {
        point: midpoint(points[0], points[1]),
        distance: Math.max(1, distance(points[0], points[1])),
        view: { ...current.current },
      };
    } else if (points.length === 1) {
      origin.current = { point: points[0], distance: 0, view: { ...current.current } };
    } else origin.current = null;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.current.size) {
      gestureStart.current = point;
      pinched.current = false;
      moved.current = false;
    }
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) {
      pinched.current = true;
      lastTap.current = null;
    }
    rebase();
    setDragging(true);
    // Pointer capture keeps drags working when the finger leaves the image.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic events have no active pointer. */
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || !pointers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (gestureStart.current && distance(point, gestureStart.current) > 8) moved.current = true;
    const start = origin.current;
    if (!start) return;
    const points = [...pointers.current.values()];
    if (points.length >= 2 && start.distance > 0) {
      const center = midpoint(points[0], points[1]);
      const scale = Math.max(1, Math.min(4, (start.view.scale * distance(points[0], points[1])) / start.distance));
      const ratio = scale / start.view.scale;
      const bounds = stageRef.current?.getBoundingClientRect();
      const cx = bounds ? bounds.left + bounds.width / 2 : 0;
      const cy = bounds ? bounds.top + bounds.height / 2 : 0;
      // Keep the image point under the midpoint anchored while pinching.
      apply({
        scale,
        x: center.x - cx - (start.point.x - cx - start.view.x) * ratio,
        y: center.y - cy - (start.point.y - cy - start.view.y) * ratio,
      });
    } else if (points.length === 1 && current.current.scale > 1) {
      apply({ scale: current.current.scale, x: start.view.x + point.x - start.point.x, y: start.view.y + point.y - start.point.y });
    }
  };
  const finishPointer = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(event.pointerId)) return;
    const end = { x: event.clientX, y: event.clientY };
    pointers.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* Already released. */
    }
    if (pointers.current.size) {
      rebase();
      return;
    }
    setDragging(false);
    origin.current = null;
    const start = gestureStart.current;
    if (event.pointerType === "touch") lastTouch.current = Date.now();
    if (cancelled || pinched.current || !start) {
      lastTap.current = null;
      return;
    }
    const dx = end.x - start.x,
      dy = end.y - start.y;
    if (current.current.scale === 1 && Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      lastTap.current = null;
      if (dx < 0) onNext();
      else onPrevious();
      return;
    }
    if (event.pointerType === "touch" && !moved.current && distance(start, end) < 8) {
      const previous = lastTap.current,
        now = Date.now();
      if (previous && now - previous.time < 320 && distance(previous.point, end) < 30) {
        changeZoom(current.current.scale === 1 ? 2 : 1);
        lastTap.current = null;
      } else lastTap.current = { point: end, time: now };
    } else lastTap.current = null;
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!enabled) return;
    event.preventDefault();
    changeZoom(current.current.scale + (event.deltaY < 0 ? STEP : -STEP));
  };
  return {
    stageRef,
    imageRef,
    view,
    dragging,
    reset,
    zoomIn: () => changeZoom(current.current.scale + STEP),
    zoomOut: () => changeZoom(current.current.scale - STEP),
    onImageLoad: () => apply(current.current),
    // Touch double-tap is handled above; ignore its compatibility dblclick.
    onDoubleClick: () => {
      if (Date.now() - lastTouch.current > 500) changeZoom(current.current.scale === 1 ? 2 : 1);
    },
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: PointerEvent<HTMLDivElement>) => finishPointer(e, false),
      onPointerCancel: (e: PointerEvent<HTMLDivElement>) => finishPointer(e, true),
      onWheel,
    },
  };
}
