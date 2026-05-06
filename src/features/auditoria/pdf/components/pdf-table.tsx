import { Text, View } from '@react-pdf/renderer'

import { pdfStyles } from '@/features/auditoria/pdf/styles/brand'

export function PdfTable({
  columns,
  rows,
}: {
  columns: Array<{ label: string; flex?: number; align?: 'left' | 'right' }>
  rows: Array<{
    key: string
    cells: Array<{
      text: string
      secondaryText?: string
      compact?: boolean
      align?: 'left' | 'right'
      emphasize?: boolean
    }>
  }>
}) {
  return (
    <View style={pdfStyles.tableWrap} wrap={false}>
      <View style={pdfStyles.tableHeader}>
        {columns.map((column) => (
          <Text
            key={column.label}
            style={
              column.align === 'right'
                ? [pdfStyles.tableHeaderCell, { flex: column.flex ?? 1 }, pdfStyles.tableHeaderCellRight]
                : [pdfStyles.tableHeaderCell, { flex: column.flex ?? 1 }]
            }
          >
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View
          key={row.key}
          style={
            rowIndex === rows.length - 1
              ? [pdfStyles.tableRow, { borderBottomWidth: 0 }]
              : pdfStyles.tableRow
          }
        >
          {row.cells.map((cell, cellIndex) => (
            <View
              key={`${row.key}-${cellIndex}`}
              style={
                cell.align === 'right'
                  ? [pdfStyles.tableCell, { flex: columns[cellIndex]?.flex ?? 1 }, pdfStyles.tableCellRight]
                  : [pdfStyles.tableCell, { flex: columns[cellIndex]?.flex ?? 1 }]
              }
            >
              <Text
                style={
                  cell.emphasize
                    ? cell.compact
                      ? [pdfStyles.tableCellPrimary, pdfStyles.tableCellCompact]
                      : pdfStyles.tableCellPrimary
                    : cell.compact
                      ? pdfStyles.tableCellCompact
                      : undefined
                }
                wrap={false}
              >
                {cell.text}
              </Text>
              {cell.secondaryText ? <Text style={pdfStyles.tableCellSecondary} wrap={false}>{cell.secondaryText}</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}