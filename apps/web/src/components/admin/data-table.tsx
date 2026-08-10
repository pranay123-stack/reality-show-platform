'use client';

import { Card, EmptyState, Skeleton, cn } from '@reality/ui';
import type { ReactNode } from 'react';

/**
 * The console's table.
 *
 * One rule shapes it: the table scrolls, the page does not. Operator tables
 * carry more columns than a phone can show, and letting the document scroll
 * sideways breaks every other layout on the screen — so the overflow is owned
 * here, inside a bounded container.
 */

export interface Column<Row> {
  key: string;
  header: string;
  /** Right-aligns and tabular-nums the cell. */
  numeric?: boolean;
  /** Hidden below `lg` — for columns that are useful but not essential. */
  secondary?: boolean;
  width?: string;
  render: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Rendered as a full-width row beneath its parent, e.g. an expanded panel. */
  renderExpanded?: (row: Row) => ReactNode;
  expandedKey?: string | null;
  caption?: string;
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  loading,
  emptyTitle = 'Nothing here',
  emptyDescription,
  emptyAction,
  renderExpanded,
  expandedKey,
  caption,
}: DataTableProps<Row>) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'px-3 py-2.5 font-medium first:pl-4 last:pr-4',
                    column.numeric && 'text-right',
                    column.secondary && 'hidden lg:table-cell',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const key = rowKey(row);
              const expanded = expandedKey === key;

              return (
                <>
                  <tr
                    key={key}
                    className={cn(
                      'border-b border-border/50 last:border-0',
                      expanded && 'bg-surface-raised',
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'px-3 py-3 align-middle first:pl-4 last:pr-4',
                          column.numeric && 'text-right tabular-nums',
                          column.secondary && 'hidden lg:table-cell',
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>

                  {expanded && renderExpanded && (
                    <tr key={`${key}-expanded`} className="border-b border-border/50">
                      <td colSpan={columns.length} className="bg-surface-raised/60 px-4 py-4">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
