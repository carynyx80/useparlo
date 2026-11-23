import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import './index.css'
import App from './App'
import { wagmiConfig, TARGET_CHAIN } from './lib/wagmi'

const queryClient = new QueryClient()

const theme = darkTheme({
  accentColor: '#FFFFFF',
  accentColorForeground: '#000000',
  borderRadius: 'large',
  fontStack: 'system',
  overlayBlur: 'small',
})
theme.colors.modalBackground = '#0A0A0A'
theme.colors.connectButtonBackground = 'rgba(255,255,255,0.06)'
theme.fonts.body = "'Inter', system-ui, sans-serif"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} initialChain={TARGET_CHAIN} modalSize="compact">
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
