import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider, AuthProvider, DataProvider } from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
)
