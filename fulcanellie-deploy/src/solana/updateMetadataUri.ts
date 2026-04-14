import 'dotenv/config';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, signerIdentity, publicKey } from '@metaplex-foundation/umi';
import {
  updateMetadataAccountV2,
  findMetadataPda,
  mplTokenMetadata,
  fetchMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import { getRpcUrlFromEnv, loadKeypairBytes } from './solanaCliEnv';

async function updateMetadataUri(mintAddress: string, newUri: string) {
  const secretKey = loadKeypairBytes();
  const rpcUrl = getRpcUrlFromEnv();

  const umi = createUmi(rpcUrl);

  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  const signer = createSignerFromKeypair(umi, umiKeypair);

  umi.use(signerIdentity(signer));
  umi.use(mplTokenMetadata());

  const mintPublicKey = publicKey(mintAddress);

  console.log(`\n📝 Updating metadata URI for token: ${mintAddress}`);
  console.log(`   RPC: ${rpcUrl}`);
  console.log(`   New URI: ${newUri}`);

  const metadataPda = findMetadataPda(umi, { mint: mintPublicKey });
  console.log(`\n🔍 Metadata PDA: ${metadataPda}`);

  try {
    const existingMetadata = await fetchMetadata(umi, metadataPda);

    if (!existingMetadata) {
      throw new Error('Metadata account not found. Create metadata first.');
    }

    const tx = await updateMetadataAccountV2(umi, {
      metadata: metadataPda,
      updateAuthority: signer,
      data: {
        name: existingMetadata.name,
        symbol: existingMetadata.symbol,
        uri: newUri,
        sellerFeeBasisPoints: existingMetadata.sellerFeeBasisPoints,
        creators: existingMetadata.creators,
        collection: existingMetadata.collection,
        uses: existingMetadata.uses,
      },
    }).sendAndConfirm(umi);

    console.log(`\n✅ Metadata URI updated!`);
    console.log(`   Transaction: ${tx}`);

    return {
      metadataPda,
      signature: tx,
    };
  } catch (error: unknown) {
    console.error('\n❌ Error updating metadata:', error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: KEYPAIR_PATH=... SOLANA_NETWORK=mainnet-beta npm run update-metadata-uri -- <mint> <new-uri>');
    console.log('\nExample:');
    console.log(
      '  npm run update-metadata-uri -- zoofwvSp4VepYrNBhUUcuGbkhYyqgrS2NhAMYniQZeA https://gateway.pinata.cloud/ipfs/QmXXX'
    );
    process.exit(1);
  }

  const mintAddress = args[0];
  const newUri = args[1];

  await updateMetadataUri(mintAddress, newUri);
}

if (require.main === module) {
  main().catch(console.error);
}

export { updateMetadataUri };
