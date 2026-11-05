'use client';

/**
 * Browser-wallet access (EIP-1193) for the actions only a party's own key may
 * take.
 *
 * EscrowContract checks `msg.sender` against the buyer, seller or arbitrator,
 * so deposits, confirmations, releases, disputes and refunds must be signed by
 * that person's wallet. The service never holds those keys and this module never
 * sends them anywhere: it asks the wallet to sign, and the wallet asks the user.
 */

import {
  createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress,
  type Address, type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

declare global {
  interface Window { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
}

const ESCROW_ABI = [
  { type: 'function', name: 'depositFunds', stateMutability: 'payable',
    inputs: [{ name: 'seller', type: 'address' }, { name: 'arbitrator', type: 'address' }, { name: 'nonce', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'confirmDelivery', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'releaseFunds', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'initiateDispute', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'resolveDispute', stateMutability: 'nonpayable',
    inputs: [{ name: 'escrowId', type: 'bytes32' }, { name: 'releaseToSeller', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'claimRefund', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'bytes32' }], outputs: [] },
] as const;

export interface OnChainParams {
  escrowId: string; escrowContract: string; chainId: number;
  seller: string; arbitrator: string; amountWei: string; nonce: string;
}

export class WalletError extends Error {}

function provider() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new WalletError('No browser wallet was found. Install MetaMask (or another EIP-1193 wallet) and reload.');
  }
  return window.ethereum;
}

/** Connects, makes sure the right network is selected, and returns the account. */
export async function connect(chainId: number): Promise<Address> {
  const eth = provider();
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts[0]) throw new WalletError('The wallet returned no account.');
  const current = Number.parseInt((await eth.request({ method: 'eth_chainId' })) as string, 16);
  if (current !== chainId) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] });
    } catch {
      throw new WalletError(`Switch your wallet to chain ${chainId} (Sepolia) and try again.`);
    }
  }
  return getAddress(accounts[0]);
}

export async function balanceEth(address: Address): Promise<number> {
  const client = createPublicClient({ chain: sepolia, transport: custom(provider()) });
  return Number(await client.getBalance({ address })) / 1e18;
}

async function send(account: Address, to: Address, data: Hex, value?: bigint): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: sepolia, transport: custom(provider()) });
  const hash = await wallet.sendTransaction({ account, chain: sepolia, to, data, value });
  const client = createPublicClient({ chain: sepolia, transport: custom(provider()) });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new WalletError(`The transaction ${hash} reverted.`);
  return hash;
}

type Call =
  | { kind: 'deposit'; params: OnChainParams }
  | { kind: 'confirm' | 'release' | 'dispute' | 'refund'; params: OnChainParams }
  | { kind: 'resolve'; params: OnChainParams; releaseToSeller: boolean };

/** Signs and sends one contract call from the connected account. */
export async function sendEscrowCall(account: Address, call: Call): Promise<Hex> {
  const { params } = call;
  const to = getAddress(params.escrowContract);
  const id = params.escrowId as Hex;
  switch (call.kind) {
    case 'deposit':
      return send(account, to, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'depositFunds',
        args: [getAddress(params.seller), getAddress(params.arbitrator), BigInt(params.nonce)] }), BigInt(params.amountWei));
    case 'confirm':
      return send(account, to, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'confirmDelivery', args: [id] }));
    case 'release':
      return send(account, to, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'releaseFunds', args: [id] }));
    case 'dispute':
      return send(account, to, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'initiateDispute', args: [id] }));
    case 'refund':
      return send(account, to, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'claimRefund', args: [id] }));
    case 'resolve':
      return send(account, to, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'resolveDispute', args: [id, call.releaseToSeller] }));
  }
}

/** Signs the wallet-link challenge (EIP-191 personal_sign). */
export async function signLinkMessage(account: Address, message: string): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: sepolia, transport: custom(provider()) });
  return wallet.signMessage({ account, message });
}
