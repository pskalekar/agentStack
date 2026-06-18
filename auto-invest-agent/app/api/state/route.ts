import { NextResponse } from 'next/server'
import { createPublicClient, http, formatUnits, getAddress } from 'viem'
import { chain } from '../../../src/chain'
import { config } from '../../../src/config'
import { loadAccount } from '../../../src/lib/account'
import { erc20Abi } from '../../../src/abi/erc20'
import { erc4626Abi } from '../../../src/abi/erc4626'

export const dynamic = 'force-dynamic'
// Next.js patches global fetch with caching; viem's RPC transport uses fetch,
// so without this the on-chain reads return stale cached results.
export const fetchCache = 'force-no-store'

function agentAddress(): `0x${string}` {
  // Prefer an explicit address so the web server needn't touch the private key.
  if (config.agentAddress) return getAddress(config.agentAddress)
  return loadAccount(config.privateKey).address
}

export async function GET() {
  try {
    const pub = createPublicClient({ chain, transport: http(config.rpcUrl, { fetchOptions: { cache: 'no-store' } }) })
    const usdc = getAddress(config.usdcAddress)
    const vault = getAddress(config.vaultAddress)
    const agent = agentAddress()

    const [liquidRaw, shares] = await Promise.all([
      pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [agent] }),
      pub.readContract({ address: vault, abi: erc4626Abi, functionName: 'balanceOf', args: [agent] }),
    ])
    const investedRaw = shares === 0n
      ? 0n
      : await pub.readContract({ address: vault, abi: erc4626Abi, functionName: 'convertToAssets', args: [shares] })

    return NextResponse.json({
      agent,
      vault,
      chainId: chain.id,
      explorer: config.explorerUrl,
      liquid: formatUnits(liquidRaw, 6),
      invested: formatUnits(investedRaw, 6),
      total: formatUnits(liquidRaw + investedRaw, 6),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to read chain state' }, { status: 500 })
  }
}
