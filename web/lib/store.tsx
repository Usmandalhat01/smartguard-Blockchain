'use client';

/**
 * React binding for the data layer.
 *
 * Two sources behind one interface. Without `NEXT_PUBLIC_API_URL` the
 * demonstration store (lib/store-core) answers from browser storage. With it,
 * the live store (lib/live-store) answers from the FastAPI service and sends
 * wallet transactions for the actions only a party's key may take. Components
 * do not know which is active.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useSession } from './auth/context';
import { isBackendConfigured, requestRiskScore } from './api';
import { CONTRACTS, SELLER_PROFILES, SEED_NOW, USERS } from './seed';
import * as core from './store-core';
import * as live from './live-store';
import type { OnChainParams } from './wallet';
import type { AuditEntry, Dispute, SystemSettings, Transaction, User } from './types';

export type NewEscrowInput = Omit<core.NewEscrowInput, 'buyerId'>;

const LIVE = isBackendConfigured();
const noopSubscribe = () => () => {};
const demoSnapshot = live.getServerSnapshot;

export interface ContractInfo {
  escrow: string; riskOracle: string; oracleOperator: string; network: string; chainId: number;
}

interface StoreValue {
  transactions: Transaction[];
  disputes: Dispute[];
  audit: AuditEntry[];
  settings: SystemSettings;
  /** True once the data source has answered at least once. */
  ready: boolean;
  backendConnected: boolean;
  /** Live mode with the contracts configured: actions are wallet transactions. */
  onChain: boolean;
  /** Last failure talking to the service, if any. */
  liveError: string | null;
  users: User[];
  contracts: ContractInfo;

  userById: (id: string) => User;
  transactionById: (id: string) => Transaction | undefined;
  disputeForTransaction: (txId: string) => Dispute | undefined;
  auditForTransaction: (txId: string) => AuditEntry[];

  createEscrow: (input: NewEscrowInput) => Promise<Transaction>;
  /** Live mode: creates the escrow (the service scores it and writes the score on chain). */
  createLiveEscrow: (body: unknown) => Promise<{ transaction: Transaction; params?: OnChainParams }>;
  /** Live mode: the buyer's wallet sends the deposit. */
  depositFromWallet: (txId: string, params: OnChainParams) => Promise<void>;
  listSellers: () => Promise<User[]>;
  confirmDelivery: (txId: string) => Promise<void>;
  releaseAfterTimeLock: (txId: string) => Promise<void>;
  initiateDispute: (txId: string, raisedByRole: 'buyer' | 'seller', reason: string) => Promise<void>;
  resolveDispute: (txId: string, forSeller: boolean, note: string) => Promise<void>;
  claimRefund: (txId: string) => Promise<void>;
  updateSettings: (patch: Partial<SystemSettings>) => void;
  resetDemo: () => void;
}

export function useStore(): StoreValue {
  const { principal } = useSession();
  const demo = useSyncExternalStore(
    LIVE ? noopSubscribe : core.subscribe, core.getSnapshot, core.getServerSnapshot,
  );
  const remote = useSyncExternalStore(
    LIVE ? live.subscribe : noopSubscribe, LIVE ? live.getSnapshot : demoSnapshot,
    LIVE ? live.getServerSnapshot : demoSnapshot,
  );
  if (LIVE) live.setRole(principal.role);

  const users: User[] = LIVE ? remote.users : USERS;
  const userById = useCallback(
    (id: string): User => users.find((u) => u.id === id)
      ?? { id, walletAddress: '0x0000000000000000000000000000000000000000', role: 'buyer', displayName: 'Unknown party', createdAt: '' },
    [users],
  );

  const transactions = LIVE ? remote.transactions : demo.transactions;
  const disputes = LIVE ? remote.disputes : demo.disputes;
  const audit = LIVE ? remote.audit : demo.audit;

  const transactionById = useCallback((id: string) => transactions.find((t) => t.id === id), [transactions]);
  const disputeForTransaction = useCallback((id: string) => disputes.find((d) => d.transactionId === id), [disputes]);
  const auditForTransaction = useCallback((id: string) => audit.filter((a) => a.transactionId === id), [audit]);

  const createEscrow = useCallback(
    async (input: NewEscrowInput) => core.createEscrow({ ...input, buyerId: principal.userId }),
    [principal.userId],
  );
  const listSellers = useCallback(async (): Promise<User[]> => {
    if (!LIVE) return USERS.filter((u) => u.role === 'seller');
    return (await live.counterparties()).map((p) => ({
      id: p.id, walletAddress: p.walletAddress, role: 'seller' as const, displayName: p.displayName, createdAt: '',
    }));
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<SystemSettings>) => (LIVE ? void live.updateSettings(patch) : core.updateSettings(patch, principal.walletAddress)),
    [principal.walletAddress],
  );

  const contracts: ContractInfo = LIVE && remote.chain.enabled
    ? {
        escrow: remote.chain.escrowContract ?? '', riskOracle: remote.chain.riskOracleContract ?? '',
        oracleOperator: remote.chain.oracleOperator ?? '', network: remote.chain.network ?? 'Ethereum Sepolia',
        chainId: remote.chain.chainId ?? 11155111,
      }
    : { ...CONTRACTS };

  return useMemo(() => ({
    transactions, disputes, audit,
    settings: LIVE ? remote.settings : demo.settings,
    ready: LIVE ? remote.hydrated : demo.hydrated,
    backendConnected: LIVE,
    onChain: LIVE && remote.chain.enabled,
    liveError: LIVE ? remote.error : null,
    users, contracts, userById, transactionById, disputeForTransaction, auditForTransaction,
    createEscrow,
    createLiveEscrow: live.createEscrow,
    depositFromWallet: live.deposit,
    listSellers,
    confirmDelivery: LIVE ? live.confirmDelivery : async (id: string) => core.confirmDelivery(id),
    releaseAfterTimeLock: LIVE ? live.releaseAfterTimeLock : async (id: string) => core.releaseAfterTimeLock(id),
    claimRefund: LIVE ? live.claimRefund : async (id: string) => core.claimRefund(id),
    initiateDispute: LIVE ? live.initiateDispute : async (id: string, r: 'buyer' | 'seller', reason: string) => core.initiateDispute(id, r, reason),
    resolveDispute: LIVE ? live.resolveDispute : async (id: string, f: boolean, n: string) => core.resolveDispute(id, f, n),
    updateSettings,
    resetDemo: LIVE ? () => {} : core.resetStore,
  }), [
    transactions, disputes, audit, remote, demo, users, contracts, userById, transactionById,
    disputeForTransaction, auditForTransaction, createEscrow, listSellers, updateSettings,
  ]);
}

export { requestRiskScore, SELLER_PROFILES, SEED_NOW };
