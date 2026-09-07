import { archiveEntityPresentation, vouEntityPresentation } from '@zerp/model'

export const targetDomainCapabilities = {
  session: { approval: false, businessVersion: false, enabled: false },
  bob: { approval: true, businessVersion: true, enabled: true },
  vou: { approval: true, businessVersion: false, enabled: false },
  app: { approval: false, businessVersion: false, enabled: true },
  aux: { approval: false, businessVersion: false, enabled: true },
  acc: { approval: false, businessVersion: false, enabled: true },
  rpt: { approval: false, businessVersion: false, enabled: false },
  wfl: { approval: true, businessVersion: true, enabled: true },
} as const

export type TargetDomain = keyof typeof targetDomainCapabilities
export type BusinessTargetDomain = Exclude<TargetDomain, 'session'>

export type NavigationResource = {
  key: string
  domain: string
  entity: string
  displayName: string
  routePath: string
}

export type NavigationResourceGroup = {
  domain: string
  displayName: string
  resources: NavigationResource[]
}

const domainPresentation: Readonly<
  Record<string, { displayName: string; order: number }>
> = {
  bob: { displayName: '业务资料', order: 10 },
  vou: { displayName: '业务单据', order: 20 },
  app: { displayName: '系统管理', order: 30 },
  aux: { displayName: '辅助资料', order: 40 },
  acc: { displayName: '会计', order: 50 },
  rpt: { displayName: '报表', order: 60 },
  wfl: { displayName: '业务流程', order: 70 },
  dcl: { displayName: '申报资料', order: 80 },
}

const appPresentation: Readonly<Record<string, string>> = {
  workbench: '工作台',
  user: '用户管理',
  role: '角色管理',
  permission: '权限目录',
  'system-parameter': '系统参数',
}

const auxPresentation: Readonly<Record<string, string>> = {
  reference: '辅助资料引用',
  'product-category': '产品分类',
  'product-type': '产品类型',
  'employee-category': '员工分类',
  department: '部门',
  position: '岗位',
  'settlement-method': '结算方式',
  'payment-method': '收款方式',
  'dictionary-type': '字典类型',
  'dictionary-item': '字典项',
  'measurement-unit': '计量单位',
  'income-expense-type': '收支类型',
  'asset-category': '资产类别',
  'operating-entity': '经营主体',
  employee: '员工',
  warehouse: '仓库',
  'fund-account': '资金账户',
  vehicle: '车辆',
}

const accPresentation: Readonly<Record<string, string>> = {
  book: '会计账簿',
  subject: '会计科目',
  mapping: '会计映射',
  opening: '会计期初',
  period: '会计期间',
}

const wflPresentation: Readonly<Record<string, string>> = {
  'process-definition': '流程定义',
  'process-instance': '流程实例',
}

function archiveName(entity: string): string | undefined {
  return entity in archiveEntityPresentation
    ? archiveEntityPresentation[
        entity as keyof typeof archiveEntityPresentation
      ].label
    : entity === 'warehouse'
      ? '仓库'
      : entity === 'wfl-process-definition'
        ? '流程定义'
        : undefined
}

export function resourceDisplayName(domain: string, entity: string): string {
  if (domain === 'app' && appPresentation[entity])
    return appPresentation[entity]
  if (domain === 'aux' && auxPresentation[entity])
    return auxPresentation[entity]
  if (domain === 'acc' && accPresentation[entity])
    return accPresentation[entity]
  if (domain === 'wfl' && wflPresentation[entity])
    return wflPresentation[entity]
  if (domain === 'rpt' && entity === 'directory') return '报表目录'
  if (domain === 'bob' && entity === 'reference') return '业务资料引用'
  if (domain === 'vou' && entity === 'reference') return '业务单据引用'
  if (domain === 'vou' && entity === 'source-line') return '业务单据来源行'
  if (domain === 'vou' && entity in vouEntityPresentation)
    return vouEntityPresentation[entity as keyof typeof vouEntityPresentation]
      .label
  if (domain === 'bob') {
    const name = archiveName(entity)
    if (name) return name
  }
  if (domain === 'dcl') {
    if (entity === 'acc-mapping') return '会计映射申报'
    const name = archiveName(entity)
    if (name) return `${name}申报`
  }
  return `${entity}（待配置名称）`
}

export function domainDisplayName(domain: string): string {
  return domainPresentation[domain]?.displayName ?? `${domain}（待配置名称）`
}

function parseApiResource(apiPath: string): NavigationResource | null {
  const match =
    /^\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/.exec(apiPath)
  if (!match || match[1] === 'session') return null
  const domain = match[1]!
  const entity = match[2]!
  return {
    key: `${domain}/${entity}`,
    domain,
    entity,
    displayName: resourceDisplayName(domain, entity),
    routePath: `/${domain}/${entity}`,
  }
}

export function collectNavigationResourceGroups(
  apiPaths: readonly string[],
): NavigationResourceGroup[] {
  const resources = new Map<string, NavigationResource>()
  for (const apiPath of apiPaths) {
    const resource = parseApiResource(apiPath)
    if (resource && !resources.has(resource.key))
      resources.set(resource.key, resource)
  }

  const byDomain = new Map<string, NavigationResource[]>()
  for (const resource of resources.values()) {
    const current = byDomain.get(resource.domain) ?? []
    current.push(resource)
    byDomain.set(resource.domain, current)
  }

  return [...byDomain.entries()]
    .sort(([left], [right]) => {
      const leftOrder =
        domainPresentation[left]?.order ?? Number.MAX_SAFE_INTEGER
      const rightOrder =
        domainPresentation[right]?.order ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.localeCompare(right)
    })
    .map(([domain, domainResources]) => ({
      domain,
      displayName: domainDisplayName(domain),
      resources: domainResources.sort((left, right) =>
        left.entity.localeCompare(right.entity),
      ),
    }))
}

export function hasNavigationResource(
  apiPaths: readonly string[],
  domain: string,
  entity: string,
): boolean {
  if (domain === 'session') return false
  return apiPaths.some((apiPath) => {
    const resource = parseApiResource(apiPath)
    return resource?.domain === domain && resource.entity === entity
  })
}
