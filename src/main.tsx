import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorPage } from './app/EditorPage.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorPage />
  </StrictMode>,
)
