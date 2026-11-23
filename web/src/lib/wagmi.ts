import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { createConfig, http, type Config } from 'wagmi'
import { bsc, bscTestnet } from 'wagmi/chains'
import { coinbaseWallet, injected } from 'wagmi/connectors'

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN ?? 56)
export const TARGET_CHAIN = CHAIN_ID === 97 ? bscTestnet : bsc
const chains = CHAIN_ID === 97 ? ([bscTestnet, bsc] as const) : ([bsc] as const)

const projectId = (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)?.trim()
export const HAS_WALLETCONNECT = !!projectId

const transports = { [bsc.id]: http(), [bscTestnet.id]: http() } as const

export const wagmiConfig: Config = projectId
  ? getDefaultConfig({ appName: 'Parlo', appUrl: 'https://useparlo.xyz', projectId, chains, transports, ssr: false })
  : createConfig({
      chains,
      transports,
      // Injected covers MetaMask, Trust Wallet, Binance Web3 Wallet, OKX etc.
      connectors: [injected({ shimDisconnect: true }), coinbaseWallet({ appName: 'Parlo' })],
    })
