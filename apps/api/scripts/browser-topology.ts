// Browser suites use the caller-owned disposable Compose database and API/Web.
export function browserTopology() {
  const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
  if (
    process.env.TARGET_DATABASE_SCOPE !== 'isolated' ||
    !databaseUrl ||
    !new URL(databaseUrl).pathname.endsWith('_test') ||
    new URL(databaseUrl).hostname !== '127.0.0.1'
  )
    throw new Error('browser E2E requires an isolated loopback *_test database')
  const apiOrigin = process.env.TARGET_API_BASE_URL
  const webOrigin = process.env.TARGET_WEB_BASE_URL
  for (const origin of [apiOrigin, webOrigin]) {
    if (!origin || new URL(origin).hostname !== '127.0.0.1')
      throw new Error(
        'browser E2E requires explicit loopback Compose API/Web URLs',
      )
  }
  return { databaseUrl, apiOrigin: apiOrigin!, webOrigin: webOrigin! }
}
