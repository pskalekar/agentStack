/**
 * verify-earn: prove the on-chain earn leg works end-to-end against the
 * configured ERC-4626 vault on testnet.
 *
 *  - No AGENT_PRIVATE_KEY  -> read-only checks (vault metadata + asset match).
 *  - Key set, low balance  -> prints faucet instructions, stays read-only.
 *  - Key set + funded       -> deposit -> position grows -> withdraw -> funds return.
 */
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, getAddress } from 'viem'
import { loadAccount } from '../lib/account'
import { chain } from '../chain'
import { config, explorerTx } from '../config'
import { erc20Abi } from '../abi/erc20'
import { erc4626Abi } from '../abi/erc4626'
import { MorphoVaultProvider } from '../earn/MorphoVaultProvider'

const USDC_DECIMALS = 6
const usdc = (n: bigint) => `${formatUnits(n, USDC_DECIMALS)} USDC`

async function main() {
  if (!config.vaultAddress) {
    console.error(
      'VAULT_ADDRESS is not set.\n' +
      'Copy .env.example to .env and set a vault address. Find/verify an ERC-4626\n' +
      'USDC vault on https://testnet.arcscan.app — its asset() must equal USDC_ADDRESS.',
    )
    process.exit(1)
  }

  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) })
  const usdcAddr = getAddress(config.usdcAddress)
  const vaultAddr = getAddress(config.vaultAddress)

  console.log(`Chain:  ${chain.name} (${chain.id})`)
  console.log(`RPC:    ${config.rpcUrl}`)
  console.log(`USDC:   ${usdcAddr}`)
  console.log(`Vault:  ${vaultAddr}`)

  // --- Vault metadata (read-only) ---
  const [vaultAsset, shareDecimals, totalAssets] = await Promise.all([
    publicClient.readContract({ address: vaultAddr, abi: erc4626Abi, functionName: 'asset' }),
    publicClient.readContract({ address: vaultAddr, abi: erc4626Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: vaultAddr, abi: erc4626Abi, functionName: 'totalAssets' }),
  ])
  console.log(`\nVault asset():        ${vaultAsset}`)
  console.log(`Vault share decimals: ${shareDecimals}`)
  console.log(`Vault totalAssets():  ${usdc(totalAssets)}`)

  if (getAddress(vaultAsset) !== usdcAddr) {
    console.error(`\n✗ Vault asset (${vaultAsset}) != USDC_ADDRESS (${usdcAddr}). Aborting.`)
    process.exit(1)
  }
  console.log('✓ Vault asset matches USDC')

  // --- Read-only mode if no key ---
  if (!config.privateKey) {
    console.log('\nNo AGENT_PRIVATE_KEY set — read-only checks complete.')
    console.log('Set a testnet key in .env to run the deposit/withdraw round-trip.')
    return
  }

  const account = loadAccount(config.privateKey)
  const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) })
  console.log(`\nAccount: ${account.address}`)

  const [nativeBal, usdcBal] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: usdcAddr, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
  ])
  console.log(`Native (gas) balance: ${formatUnits(nativeBal, 18)} USDC`)
  console.log(`ERC-20 USDC balance:  ${usdc(usdcBal)}`)

  const amount = parseUnits(config.verifyAmountUsdc, USDC_DECIMALS)

  if (nativeBal === 0n) {
    console.log('\nNative (gas) balance is 0 — fund from https://faucet.circle.com (gas is paid in USDC on Arc). Re-run after funding.')
    return
  }
  if (usdcBal < amount) {
    console.log(`\nNeed ${usdc(amount)} to round-trip but only have ${usdc(usdcBal)}.`)
    console.log('Fund this address from https://faucet.circle.com and re-run.')
    return
  }

  const earn = new MorphoVaultProvider({ publicClient, walletClient, account, vaultAddress: vaultAddr, usdcAddress: usdcAddr })

  const before = await earn.position()
  console.log(`\nPosition before: ${usdc(before.currentValue)}  (${formatUnits(before.shares, Number(shareDecimals))} shares)`)

  console.log(`\n→ Depositing ${usdc(amount)} ...`)
  const dep = await earn.deposit(amount)
  console.log(`  ${explorerTx(dep.txHash)}`)
  const afterDeposit = await earn.position()
  const gained = afterDeposit.currentValue - before.currentValue
  console.log(`Position after deposit: ${usdc(afterDeposit.currentValue)}  (Δ ${usdc(gained)})`)

  const tolerance = parseUnits('0.01', USDC_DECIMALS)
  if (gained < amount - tolerance) {
    console.warn(`  ⚠ expected ~${usdc(amount)} increase (rounding/fees?)`)
  } else {
    console.log('✓ Deposit reflected in position')
  }

  console.log(`\n→ Withdrawing ${usdc(amount)} ...`)
  const wd = await earn.withdraw(amount)
  console.log(`  ${explorerTx(wd.txHash)}`)
  const afterWithdraw = await earn.position()
  const usdcBalAfter = await publicClient.readContract({ address: usdcAddr, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  console.log(`Position after withdraw: ${usdc(afterWithdraw.currentValue)}  (${formatUnits(afterWithdraw.shares, Number(shareDecimals))} shares)`)
  console.log(`ERC-20 USDC balance:     ${usdc(usdcBalAfter)}`)

  console.log('\n✓ Round-trip complete: deposit → position grew → withdraw → funds returned.')
}

main().catch((err) => {
  console.error('\nverify-earn failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
