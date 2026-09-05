import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const frontendRoot = process.cwd()

describe('production frontend deployment configuration', () => {
  it('builds Cloudflare Pages against the public target API', async () => {
    const productionEnvironment = await readFile(
      `${frontendRoot}/.env.production`,
      'utf8',
    )

    expect(productionEnvironment).toContain(
      'VITE_TARGET_API_BASE_URL=https://zerp-api.bytesucceed.com',
    )
    expect(productionEnvironment).not.toContain('VITE_API_BASE_URL=')
    expect(productionEnvironment).not.toContain('127.0.0.1')
  })

  it('allows the configured API and Cloudflare beacon in both web deployments', async () => {
    const [pagesHeaders, nginxConfiguration] = await Promise.all([
      readFile(`${frontendRoot}/public/_headers`, 'utf8'),
      readFile(`${frontendRoot}/nginx.target.conf`, 'utf8'),
    ])

    for (const configuration of [pagesHeaders, nginxConfiguration]) {
      expect(configuration).toContain('https://static.cloudflareinsights.com')
      expect(configuration).toContain('https://cloudflareinsights.com')
    }
    expect(pagesHeaders).toContain('https://zerp-api.bytesucceed.com')
    expect(nginxConfiguration).toContain('${ZERP_API_BROWSER_URL}')
  })
})
