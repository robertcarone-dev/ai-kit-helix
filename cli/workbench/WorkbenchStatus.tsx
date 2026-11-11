import { Badge } from '@helix/kit';
import { CircleCheck, CircleHelp, ClipboardCheck, FileSearch, RotateCcw, Wrench } from 'lucide-react';
import { statusText, type WorkStatus } from './workbench-presentation';
const icons = { verified: CircleCheck, fix: Wrench, evidence: FileSearch, ready: ClipboardCheck, accepted: CircleCheck, define: CircleHelp, recheck: RotateCcw };
export function WorkbenchStatus({ status }: { status: WorkStatus }) {
  const Icon = icons[status];
  return <Badge variant="outline" className={`wb-status wb-status-${status}`}><Icon size={15} aria-hidden="true" />{statusText[status]}</Badge>;
}
