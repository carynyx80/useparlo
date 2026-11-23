import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { createConfig, http, type Config } from 'wagmi'
import { bsc, bscTestnet, foundry } from 'wagmi/chains'
import { coinbaseWallet, injected } from 'wagmi/connectors'
import type { Chain } from 'viem'

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN ?? 56)
const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined)?.trim() || undefined
/** Local anvil/foundry chain is only enabled when VITE_CHAIN=31337 (dev). Production stays on BSC. */
export const IS_LOCAL_CHAIN = CHAIN_ID === foundry.id

export const TARGET_CHAIN: Chain = IS_LOCAL_CHAIN ? foundry : CHAIN_ID === 97 ? bscTestnet : bsc
const chains: readonly [Chain, ...Chain[]] = IS_LOCAL_CHAIN ? [foundry] : CHAIN_ID === 97 ? [bscTestnet, bsc] : [bsc]

const projectId = (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)?.trim()
export const HAS_WALLETCONNECT = !!projectId

const transports = Object.fromEntries(
  chains.map((c) => [c.id, http(c.id === TARGET_CHAIN.id ? RPC_URL : undefined)]),
) as Record<number, ReturnType<typeof http>>

export const wagmiConfig: Config = projectId
  ? getDefaultConfig({ appName: 'Parlo', appUrl: 'https://useparlo.xyz', projectId, chains, transports, ssr: false })
  : createConfig({
      chains,
      transports,
      // Injected covers MetaMask, Trust Wallet, Binance Web3 Wallet, OKX etc.
      connectors: [injected({ shimDisconnect: true }), coinbaseWallet({ appName: 'Parlo' })],
    })
