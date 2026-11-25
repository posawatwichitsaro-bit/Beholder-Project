// Stylesheets first, in cascade order: tokens → legacy screens → UI kit → HUD shell.
import './ui/tokens.css'
import './styles/legacy.css'
import './ui/ui.css'
import './features/shell/shell.css'
import './features/entry/lobby.css'
import './features/board/board.css'
import './features/sheets/sheet.css'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
