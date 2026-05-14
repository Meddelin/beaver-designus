import * as React from "react";
import { ArrowUp, Square } from "lucide-react";
import { Kbd, IconButton } from "../ui/primitives.tsx";
import { cn } from "../lib/cn.ts";

export interface ComposerProps {
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
  hint?: React.ReactNode;
  /** Imperative ref to focus the textarea from hotkeys. */
  focusRef?: React.RefObject<HTMLTextAreaElement>;
}

export function Composer({
  busy,
  onSend,
  onCancel,
  placeholder = "Describe the screen, page, or section to compose…",
  hint,
  focusRef,
}: ComposerProps): React.ReactElement {
  const [draft, setDraft] = React.useState("");
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (focusRef) (focusRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    },
    [focusRef]
  );

  // auto-resize
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [draft]);

  const submit = () => {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  };

  return (
    <form
      className="relative flex flex-col gap-1 px-3 pt-2 pb-3 border-t border-line bg-paper-1/70 backdrop-blur"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <div className={cn(
        "flex items-end gap-2 rounded-md border bg-paper-2 transition-shadow",
        "border-line focus-within:border-accent/70 focus-within:ring-accent-soft",
      )}>
        <textarea
          ref={setRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          rows={1}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && busy) {
              e.preventDefault();
              onCancel();
            }
          }}
          aria-label="Compose message"
          className={cn(
            "flex-1 resize-none bg-transparent outline-none px-3 py-2.5",
            "text-[13.5px] text-ink-0 placeholder:text-ink-3 leading-relaxed",
            "max-h-[180px]"
          )}
        />
        <div className="pb-1.5 pr-1.5">
          {busy ? (
            <IconButton type="button" onClick={onCancel} variant="secondary" size="icon-sm" aria-label="Cancel">
              <Square size={13} />
            </IconButton>
          ) : (
            <IconButton type="submit" variant="primary" size="icon-sm" disabled={!draft.trim()} aria-label="Send">
              <ArrowUp size={15} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 px-1 text-[11px] text-ink-3 font-mono">
        {hint ?? (
          <>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> send</span>
            <span className="flex items-center gap-1"><Kbd>⇧</Kbd><Kbd>↵</Kbd> newline</span>
            <span className="flex items-center gap-1"><Kbd>esc</Kbd> cancel</span>
          </>
        )}
      </div>
    </form>
  );
}
