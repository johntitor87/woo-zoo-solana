  async function sendZooPayment(amount) {
    ...
    const shopTokenAccount = getAssociatedTokenAddressSync(
      solanaWeb3,
      mintPubKey,
      toPubKey,
      TOKEN_PROGRAM_ID,
      associatedTokenProgramId
    );
    ...
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      solanaWeb3,
      fromPubKey,
      shopTokenAccount,
      toPubKey,
      mintPubKey,
      TOKEN_PROGRAM_ID,
      associatedTokenProgramId
    );

    const tx = new solanaWeb3.Transaction().add(createAtaIx).add(transferIx);
