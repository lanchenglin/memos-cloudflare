import { useBlobUrls } from "../hooks/useBlobUrls";
import { useRef, type FC } from "react";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/utils/i18n";
import { validationService } from "../services";
import { useEditorContext } from "../state";
import InsertMenu from "../Toolbar/InsertMenu";
import VisibilitySelector from "../Toolbar/VisibilitySelector";
import type { EditorToolbarProps } from "../types";

export const EditorToolbar: FC<EditorToolbarProps> = ({ onSave, onCancel, memoName, onAudioRecorderClick }) => {
  const t = useTranslate();
  const imageInput = useRef<HTMLInputElement>(null);
  const { createBlobUrl } = useBlobUrls();
  const { state, actions, dispatch } = useEditorContext();
  const { valid } = validationService.canSave(state);

  const isSaving = state.ui.isLoading.saving;

  const handleLocationChange = (location: typeof state.metadata.location) => {
    dispatch(actions.setMetadata({ location }));
  };

  const handleToggleFocusMode = () => {
    dispatch(actions.toggleFocusMode());
  };

  const handleVisibilityChange = (visibility: typeof state.metadata.visibility) => {
    dispatch(actions.setMetadata({ visibility }));
  };

  return (
    <div className="w-full flex flex-row flex-wrap gap-2 justify-between items-center mb-2">
      <div className="flex flex-row flex-wrap gap-1 justify-start items-center">
        <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif,application/pdf" multiple hidden
          onChange={e => {
            for (const file of Array.from(e.target.files || [])) {
              dispatch(actions.addLocalFile({ file, previewUrl: createBlobUrl(file), origin: "upload" }));
            }
            e.target.value = "";
          }} />
        <Button variant="ghost" size="sm" type="button" disabled={isSaving} onClick={() => imageInput.current?.click()}>上传图片</Button>
        <Button variant="ghost" size="sm" type="button" disabled={isSaving} title="添加 #待整理，之后可从首页筛选"
          onClick={() => {
            if (!/(?:^|\s)#待整理(?:\s|$)/u.test(state.content)) {
              dispatch(actions.updateContent(`${state.content.trimEnd()}${state.content.trim() ? "\n\n" : ""}#待整理`));
            }
          }}>待整理</Button>
        <InsertMenu
          isUploading={state.ui.isLoading.uploading}
          location={state.metadata.location}
          onLocationChange={handleLocationChange}
          onToggleFocusMode={handleToggleFocusMode}
          memoName={memoName}
          onAudioRecorderClick={onAudioRecorderClick}
        />
      </div>

      <div className="flex flex-row justify-end items-center gap-2">
        <VisibilitySelector value={state.metadata.visibility} onChange={handleVisibilityChange} />

        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
            {t("common.cancel")}
          </Button>
        )}

        <Button onClick={onSave} disabled={!valid || isSaving}>
          {isSaving ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>
    </div>
  );
};
