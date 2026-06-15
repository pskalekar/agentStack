import 'dotenv/config'

function opt(name: string, fallback: string): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

export const config = {
  rpcUrl: opt('RPC_URL', 'https://rpc.testnet.arc.network'),
  chainId: Number(opt('CHAIN_ID', '5042002')),
  explorerUrl: opt('EXPLORER_URL', 'https://testnet.arcscan.app'),
  usdcAddress: opt('USDC_ADDRESS', '0x3600000000000000000000000000000000000000') as `0x${string}`,
  vaultAddress: (process.env.VAULT_ADDRESS ?? '') as `0x${string}`,
  privateKey: process.env.AGENT_PRIVATE_KEY ?? '',
  bufferUsdc: opt('BUFFER_USDC', '2'),
  tickSeconds: Number(opt('TICK_SECONDS', '15')),
  verifyAmountUsdc: opt('VERIFY_AMOUNT_USDC', '1'),
  // demo: where a "service payment" is sent, and how much a task costs.
  payeeAddress: (process.env.PAYEE_ADDRESS ?? '') as `0x${string}`,
  taskCostUsdc: opt('TASK_COST_USDC', '4'),
  // USDC kept on hand for gas (gas is paid in USDC on Arc).
  gasReserveUsdc: opt('GAS_RESERVE_USDC', '0.05'),
}

export function explorerTx(hash: string): string {
  return `${config.explorerUrl}/tx/${hash}`
}
