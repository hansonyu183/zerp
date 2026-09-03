import { readFileSync } from 'node:fs'

export type WflStarlarkRequest = {
  source: string
  operation: 'compile' | 'evaluate'
  sourceNodeKey?: string
  input?: unknown
}

type SourceTemplate =
  | string
  | { repeat: { text: string; count: number } }
  | { nodes: number }
  | { edges: number }

export type WflStarlarkCase = {
  name: string
  request: Omit<WflStarlarkRequest, 'source'>
  source: SourceTemplate
  expect: {
    error?: string
    graph?: unknown
    evaluation?: unknown
    deterministic?: true
  }
}

function materializeSource(source: SourceTemplate): string {
  if (typeof source === 'string') return source
  if ('repeat' in source) return source.repeat.text.repeat(source.repeat.count)
  if ('nodes' in source) {
    const nodes = Array.from(
      { length: source.nodes },
      (_, index) =>
        `node(key="n${index}", name="节点${index}", entity="sale-order")`,
    ).join('\n')
    return `${nodes}\nworkflow(code="node-limit", name="节点限制", root=node(key="root", name="根", entity="sale-order"))`
  }
  return `root = node(key="root", name="销售订单", entity="sale-order")
child = node(key="child", name="销售出库", entity="sale-outbound")
workflow(code="edge-limit", name="边限制", root=root, edges=[${'edge(source=root, target=child, relation="outbound", action=sale_outbound(initial={})),'.repeat(source.edges)}])`
}

export function materializeCase(item: WflStarlarkCase): WflStarlarkRequest {
  return { ...item.request, source: materializeSource(item.source) }
}

export const wflStarlarkCorpus = JSON.parse(
  readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'),
) as readonly WflStarlarkCase[]
