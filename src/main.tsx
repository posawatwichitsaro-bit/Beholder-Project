import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import './ui/tokens.css'
import './styles/legacy.css'
import './ui/ui.css'

createRoot(document.getElementById('root')!).render(<App />)
