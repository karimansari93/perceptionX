import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// OrgWorkspace owns a slot at the right end of its tab bar. A section renders
// its page-level buttons through <WorkspaceActions> so they sit on the same
// line as the tabs; outside a workspace (e.g. the standalone admin tabs) the
// buttons render in place instead.
export const WorkspaceActionsSlot = createContext<HTMLElement | null>(null);

export const WorkspaceActions = ({ children, fallbackClassName }: { children: ReactNode; fallbackClassName?: string }) => {
  const slot = useContext(WorkspaceActionsSlot);
  if (slot) return createPortal(children, slot);
  return <div className={fallbackClassName ?? 'flex items-center gap-2'}>{children}</div>;
};

/** True inside an org workspace, where page titles and buttons move to the tab bar. */
export const useInWorkspace = () => useContext(WorkspaceActionsSlot) !== null;
