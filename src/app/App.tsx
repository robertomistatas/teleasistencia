import { BrowserRouter } from 'react-router-dom'

import { AppRouter } from '@/app/router'
import { AuthProvider } from '@/features/auth/auth-context'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App