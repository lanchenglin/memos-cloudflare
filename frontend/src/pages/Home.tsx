import { useState } from "react";
import { Button } from "@/components/ui/button";
import MemoView from "@/components/MemoView";
import PagedMemoList from "@/components/PagedMemoList";
import { useInstance } from "@/contexts/InstanceContext";
import { useMemoFilters, useMemoSorting } from "@/hooks";
import useCurrentUser from "@/hooks/useCurrentUser";
import { State } from "@/types/proto/api/v1/common_pb";
import { Memo } from "@/types/proto/api/v1/memo_service_pb";

const Home = () => {
  const user = useCurrentUser();
  const [view, setView] = useState("all");
  const { isInitialized } = useInstance();

  const memoFilter = useMemoFilters({
    creatorName: user?.name,
    includeShortcuts: true,
    includePinned: true,
  });

  const { listSort, orderBy } = useMemoSorting({
    pinnedFirst: true,
    state: State.NORMAL,
  });

  return (
    <div className="w-full min-h-full bg-background text-foreground">
      {user && <div className="px-4 pt-4 pb-2 space-y-2">
        <p className="text-sm text-muted-foreground">先记下来，之后再整理。支持粘贴截图、拖入图片和 #标签。</p>
        <div className="flex gap-2 flex-wrap">
          {[["all", "全部"], ["inbox", "待整理"], ["images", "图片"], ["pinned", "置顶"]].map(([key, label]) =>
            <Button key={key} size="sm" variant={view === key ? "default" : "outline"} onClick={() => setView(key)}>{label}</Button>)}
        </div>
      </div>}
      <PagedMemoList
        renderer={(memo: Memo) => <MemoView key={`${memo.name}-${memo.updateTime}`} memo={memo} showVisibility showPinned compact />}
        listSort={listSort}
        orderBy={orderBy}
        filter={[memoFilter, view === "inbox" ? 'tag == "待整理"' : view === "images" ? "has_image" : view === "pinned" ? "pinned" : ""].filter(Boolean).map(v => `(${v})`).join(" && ")}
        enabled={isInitialized}
        showMemoEditor
      />
    </div>
  );
};

export default Home;
