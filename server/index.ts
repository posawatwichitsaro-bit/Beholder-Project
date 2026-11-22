import { createApp } from './app.ts'
import { migrate, postgres } from './store.ts'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const database = postgres(process.env.DATABASE_URL)
await migrate(database)
const server = await createApp(database, process.env.ASSET_DIR ?? '.data/maps')
server.listen(Number(process.env.PORT ?? '3000'), '0.0.0.0', () => console.log('Beholder is ready'))
