import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const RootDashboard: React.FC = () => (
  <p>Hello from the root React app! Use this for admin testing.</p>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootDashboard />
  </React.StrictMode>
)
