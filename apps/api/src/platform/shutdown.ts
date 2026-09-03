export interface RuntimeServer {
  close(callback: (error?: Error) => void): unknown
  closeAllConnections?(): void
}

export interface RuntimeDatabase {
  destroy(): Promise<void>
}

export async function closeRuntime(
  server: RuntimeServer,
  database: RuntimeDatabase,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections?.()
      resolve()
    }, timeoutMs)

    server.close((error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    })
  })
  await database.destroy()
}
