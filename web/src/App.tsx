import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'

const TradeApp = lazy(() => import('./pages/TradeApp'))

export default function App() {
  return (
    <>
      <div className="grain" aria-hidden />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/app"
          element={
            <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
              <TradeApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Landing />} />
      </Routes>
    </>
  )
}
