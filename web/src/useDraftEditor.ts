import { useEffect, useRef } from "react";
import { useStore } from "./state/store";

/** Register an in-tool draft so the header Undo/Redo buttons and leave-guards drive it. */
export function useDraftEditor(session: {
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  captureUndo?: boolean;
  undo: () => void;
  redo: () => void;
  discardMessage: string;
} | null) {
  const bindEditor = useStore((s) => s.bindEditor);
  const undoRef = useRef(session?.undo);
  const redoRef = useRef(session?.redo);
  undoRef.current = session?.undo;
  redoRef.current = session?.redo;

  const dirty = session?.dirty ?? false;
  const canUndo = session?.canUndo ?? false;
  const canRedo = session?.canRedo ?? false;
  const captureUndo = session?.captureUndo ?? dirty;
  const discardMessage = session?.discardMessage ?? "";
  const active = session != null;

  useEffect(() => {
    if (!active) {
      bindEditor(null);
      return;
    }
    bindEditor({
      dirty,
      canUndo,
      canRedo,
      captureUndo,
      discardMessage,
      undo: () => undoRef.current?.(),
      redo: () => redoRef.current?.(),
    });
    return () => bindEditor(null);
  }, [active, dirty, canUndo, canRedo, captureUndo, discardMessage, bindEditor]);
}
