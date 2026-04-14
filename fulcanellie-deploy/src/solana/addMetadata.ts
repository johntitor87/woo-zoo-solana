import 'dotenv/config';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, publicKey } from '@metaplex-foundation/umi';
import {
  createMetadataAccountV3,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import { Keypair } from '@solana/web3.js';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { expandHome, getRpcUrlFromEnv, loadKeypairBytes } from './solanaCliEnv';

function stringifyMetaPda(p: unknown): string {
  if (Array.isArray(p) && p[0] != null) return String(p[0]);
  return String(p);
}

/**
 * Pin Metaplex-style off-chain metadata JSON to IPFS via Pinata (pinJSONToIPFS).
 */
async function pinJsonToPinata(
  jwt: string,
  meta: { name: string; symbol: string; description: string; image: string }
): Promise<string> {
  const res = await axios.post(
    'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    {
      pinataContent: meta,
      pinataMetadata: { name: `${meta.symbol}-token-metadata` },
    },
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      maxBodyLength: Infinity,
    }
  );
  const hash = res.data?.IpfsHash;
  if (!hash) throw new Error('Pinata response missing IpfsHash');
  return `https://gateway.pinata.cloud/ipfs/${hash}`;
}

async function resolveMetadataUri(
  uriArg: string,
  name: string,
  symbol: string,
  description: string | undefined
): Promise<string> {
  const desc = description || `${name} token`;

  if (uriArg === '@pinata') {
    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
      throw new Error(
        'URI is @pinata but PINATA_JWT is not set. Get a JWT at https://app.pinata.cloud/ or pass a direct https/ipfs metadata URL as the 4th argument.'
      );
    }
    const imageUrl =
      process.env.ZOO_TOKEN_IMAGE_URL ||
      'https://placehold.co/512x512/0b0b0b/00ffa3/png?text=ZOO';
    return pinJsonToPinata(jwt, {
      name,
      symbol,
      description: desc,
      image: imageUrl,
    });
  }

  if (uriArg.startsWith('@file:')) {
    const filePath = expandHome(uriArg.slice('@file:'.length));
    if (!fs.existsSync(filePath)) {
      throw new Error(`Metadata JSON not found: ${filePath}`);
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const meta = {
      name: String(raw.name ?? name),
      symbol: String(raw.symbol ?? symbol),
      description: String(raw.description ?? desc),
      image: String(raw.image ?? ''),
    };
    if (!meta.image) {
      throw new Error(`Off-chain JSON must include "image" URL: ${filePath}`);
    }
    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
      throw new Error(
        'URI is @file:... — after validating JSON, set PINATA_JWT to upload it, or upload the file manually and pass the resulting https/ipfs metadata URL.'
      );
    }
    return pinJsonToPinata(jwt, meta);
  }

  if (!uriArg.startsWith('http://') && !uriArg.startsWith('https://') && !uriArg.startsWith('ipfs://')) {
    throw new Error(
      'Metadata URI must be @pinata, @file:path/to.json, ipfs://..., or https://... pointing at JSON (not a bare image URL).'
    );
  }
  return uriArg;
}

async function addMetadata(
  mintAddress: string,
  name: string,
  symbol: string,
  uriArg: string,
  description?: string
) {
  const secretKey = loadKeypairBytes();
  const keypair = Keypair.fromSecretKey(secretKey);
  const rpcUrl = getRpcUrlFromEnv();

  const umi = createUmi(rpcUrl);
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const signer = createSignerFromKeypair(umi, umiKeypair);

  umi.use(signerIdentity(signer));
  umi.use(mplTokenMetadata());

  const mintPublicKey = publicKey(mintAddress);

  console.log(`\n📝 Metaplex metadata → mint ${mintAddress}`);
  console.log(`   RPC: ${rpcUrl}`);
  console.log(`   Payer / update authority: ${keypair.publicKey.toBase58()}`);
  console.log(`   Name: ${name} | Symbol: ${symbol}`);

  const metadataUri = await resolveMetadataUri(uriArg, name, symbol, description);
  console.log(`   URI (off-chain JSON): ${metadataUri}`);

  const templatePath = path.join(process.cwd(), `metadata-${symbol}-pinned-ref.json`);
  fs.writeFileSync(
    templatePath,
    JSON.stringify({ note: 'last URI used on-chain', metadataUri, name, symbol }, null, 2)
  );
  console.log(`\n📄 Wrote ${templatePath}`);

  const metadataPda = findMetadataPda(umi, { mint: mintPublicKey });
  console.log(`\n🔍 Metadata PDA: ${stringifyMetaPda(metadataPda)}`);

  try {
    const tx = await createMetadataAccountV3(umi, {
      metadata: metadataPda,
      mint: mintPublicKey,
      mintAuthority: signer,
      payer: signer,
      updateAuthority: signer,
      data: {
        name,
        symbol,
        uri: metadataUri,
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null,
      },
      isMutable: true,
      collectionDetails: null,
    }).sendAndConfirm(umi);

    const sig =
      typeof tx === 'string'
        ? tx
        : tx && typeof tx === 'object' && 'signature' in tx
          ? String((tx as { signature: unknown }).signature)
          : JSON.stringify(tx);
    console.log(`\n✅ createMetadataAccountV3 confirmed`);
    console.log(`   Signature: ${sig}`);
    return { metadataPda: stringifyMetaPda(metadataPda), signature: sig, metadataUri };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Error creating metadata:', error);
    if (msg.includes('already in use') || msg.includes('0x0')) {
      console.log('\n💡 Metadata account may already exist. Use: npm run update-metadata-uri');
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.log(
      'Usage: KEYPAIR_PATH=... SOLANA_NETWORK=mainnet-beta npm run add-metadata -- <mint> <name> <symbol> <uri|@pinata|@file:./meta.json> [description]'
    );
    console.log('\n<uri>:');
    console.log('  https://... or ipfs://... → Metaplex off-chain JSON (must include image, name, symbol)');
    console.log('  @pinata → builds JSON from name/symbol/description + ZOO_TOKEN_IMAGE_URL (or placeholder), pins via PINATA_JWT');
    console.log('  @file:./path.json → reads JSON, pins via PINATA_JWT');
    console.log('\nExample (mainnet, Pinata):');
    console.log(
      '  KEYPAIR_PATH=~/.config/solana/mainnet.json SOLANA_NETWORK=mainnet-beta \\'
    );
    console.log(
      '    npm run add-metadata -- zoofwvSp4VepYrNBhUUcuGbkhYyqgrS2NhAMYniQZeA "ZOO" "ZOO" @pinata "ZOO token"'
    );
    process.exit(1);
  }

  const mintAddress = args[0];
  const name = args[1];
  const symbol = args[2];
  const uriArg = args[3];
  const description = args[4];

  await addMetadata(mintAddress, name, symbol, uriArg, description);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { addMetadata };
