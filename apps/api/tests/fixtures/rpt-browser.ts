import { ulid } from 'ulid'
import type { ApprovalActor } from '@zerp/model'
import type { RptService } from '../../src/rpt/service.ts'

export async function createRptBrowserFixture(
  service: RptService,
  actor: ApprovalActor,
) {
  return service.save(
    {
      subjectId: ulid(),
      expectedRevision: null,
      name: '参数查询与导出',
      description: 'RPT browser fixture',
      enabled: true,
      sql: `SELECT n::integer AS line_no, :name::text AS customer_name, :amount::numeric AS amount,
      :flag::boolean AS flag, CASE :state::text WHEN 'OPEN' THEN '开放' ELSE '关闭' END AS state,
      (:dates::date[])[1] AS business_date
      FROM generate_series(1,25) n WHERE n >= :minimum::integer AND (:department::varchar IS NULL OR EXISTS (SELECT 1 FROM aux_objects WHERE entity = 'department' AND id = :department)) ORDER BY n`,
      parameters: [
        {
          key: 'department',
          name: '部门',
          type: 'REFERENCE',
          referenceType: 'DEPARTMENT',
          required: false,
        },
        { key: 'name', name: '客户名称', type: 'TEXT', required: true },
        { key: 'amount', name: '金额', type: 'DECIMAL', required: true },
        {
          key: 'minimum',
          name: '起始序号',
          type: 'INTEGER',
          required: true,
          defaultValue: 1,
        },
        {
          key: 'flag',
          name: '标记',
          type: 'BOOLEAN',
          required: false,
          defaultValue: false,
        },
        {
          key: 'state',
          name: '状态',
          type: 'ENUM',
          required: true,
          defaultValue: 'OPEN',
          enumValues: ['OPEN', 'CLOSED'],
          enumCaptions: { OPEN: '开放', CLOSED: '关闭' },
        },
        {
          key: 'dates',
          name: '期间',
          type: 'DATE_RANGE',
          required: true,
          defaultValue: ['2026-09-01', '2026-09-30'],
        },
      ],
      columns: [
        {
          alias: 'line_no',
          name: '序号',
          order: 1,
          type: 'INTEGER',
          width: 80,
          visible: true,
        },
        {
          alias: 'customer_name',
          name: '客户名称',
          order: 2,
          type: 'TEXT',
          width: 180,
          visible: true,
        },
        {
          alias: 'amount',
          name: '金额',
          order: 3,
          type: 'DECIMAL',
          width: 180,
          visible: true,
        },
        {
          alias: 'flag',
          name: '标记',
          order: 4,
          type: 'BOOLEAN',
          width: 80,
          visible: true,
        },
        {
          alias: 'state',
          name: '状态',
          order: 5,
          type: 'TEXT',
          width: 80,
          visible: true,
        },
        {
          alias: 'business_date',
          name: '业务日期',
          order: 6,
          type: 'DATE',
          width: 120,
          visible: true,
        },
      ],
    },
    actor,
    'rpt-browser-fixture',
  )
}
