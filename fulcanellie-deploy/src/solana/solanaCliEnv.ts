import * as fs from 'fs';
import * as path from 'path';

export function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || process.env.USERPROFILE || '', p.slice(2));
  }
  return p;
}

export function loadKeypairBytes(): Uint8Array {
  const keypairPath = expandHome(
    process.env.KEYPAIR_PATH ||
      process.env.WALLET_JSON_PATH ||
      path.join(process.cwd(), 'wallet.json')
  );
  if (!fs.existsSync(keypairPath)) {
    throw new Error(
      `Keypair not found. Set KEYPAIR_PATH or create wallet.json. Tried: ${keypairPath}`
    );
  }
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Uint8Array.from(secretKey);
}

export function getRpcUrlFromEnv(): string {
  const fromEnv = process.env.SOLANA_RPC_URL || process.env.MAINNET_RPC || process.env.RPC_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const net = (process.env.SOLANA_NETWORK || '').toLowerCase();
  if (net === 'mainnet' || net === 'mainnet-beta') {
    return 'https://api.mainnet-beta.solana.com';
  }
  return 'https://api.devnet.solana.com';
}
