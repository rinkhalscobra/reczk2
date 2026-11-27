import { useLanguage } from '@/contexts/LanguageContext';
import { TableCell, TableHead } from '@/components/ui/table';

import type { AssignmentNames } from '@/lib/clientAssignments';

export function ClientAssignmentHeaders() {
  const { t } = useLanguage();
  return <>
    <TableHead className="hidden lg:table-cell">{t('customerDetail.assignedAgent')}</TableHead>
    <TableHead className="hidden lg:table-cell">{t('admin.group')}</TableHead>
    <TableHead className="hidden lg:table-cell">{t('hierarchy.assignedSupervisor')}</TableHead>
  </>;
}

export function ClientAssignmentCells({ names }: { names: AssignmentNames }) {
  return <>
    <TableCell className="hidden font-medium lg:table-cell">{names.agent}</TableCell>
    <TableCell className="hidden lg:table-cell">{names.group}</TableCell>
    <TableCell className="hidden lg:table-cell">{names.supervisor}</TableCell>
  </>;
}

export function AssignmentSummary({ names }: { names: AssignmentNames }) {
  const { t } = useLanguage();
  return <dl className="mt-2 space-y-1 text-xs font-normal text-muted-foreground lg:hidden">
    {names.agent !== undefined && <div><dt className="inline">{t('customerDetail.assignedAgent')}: </dt><dd className="inline text-foreground">{names.agent}</dd></div>}
    <div><dt className="inline">{t('admin.group')}: </dt><dd className="inline text-foreground">{names.group}</dd></div>
    <div><dt className="inline">{t('hierarchy.assignedSupervisor')}: </dt><dd className="inline text-foreground">{names.supervisor}</dd></div>
  </dl>;
}
