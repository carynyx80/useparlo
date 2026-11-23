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
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-live="polite"
                  style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 14, letterSpacing: '0.02em' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(198,255,61,0.25)', borderTopColor: '#C6FF3D', animation: 'parlo-spin 0.8s linear infinite' }}
                    />
                    Loading Parlo trading…
                  </div>
                  <style>{'@keyframes parlo-spin{to{transform:rotate(360deg)}}'}</style>
                </div>
              }
            >
              <TradeApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Landing />} />
      </Routes>
    </>
  )
}
