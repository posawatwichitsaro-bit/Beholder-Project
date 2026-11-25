import pg from 'pg'
import { readFile } from 'node:fs/promises'

export type Query = <T extends object = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>
export type Database = { query: Query; transaction<T>(work: (query: Query) => Promise<T>): Promise<T> }

export async function migrate(database: Database) {
  await database.transaction(async query => {
    for (const name of ['001', '002', '003', '004']) {
      const source = await readFile(new URL('./migrations/' + name + '.sql', import.meta.url), 'utf8')
      for (const statement of source.split(';').filter(part => part.trim())) await query(statement)
    }
  })
}

export function postgres(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString })
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(work) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work((sql, values) => client.query(sql, values))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    }
  }
}
