import { defineChain } from 'viem'
import { config } from './config'

// Arc testnet: USDC is the native gas token (18 decimals as native; the ERC-20
// interface at USDC_ADDRESS uses 6 decimals). Defined from config so the demo
// can be pointed at another EVM testnet by changing env vars.
export const chain = defineChain({
  id: config.chainId,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: { default: { name: 'Arcscan', url: config.explorerUrl } },
  testnet: true,
})
