import {
    AccountInterface,
    CallData,
    InvocationsDetails,
    TransactionFinalityStatus,
} from "starknet";

/**
 * Pre-funds a given account by initiating a transfer transaction.
 *
 * @param address - The destination address to which funds are to be transferred.
 * @param account - The source account from which funds will be deducted.
 * @param feeTokenAddress - The Ethereum contract address responsible for the transfer.
 *                             If not provided, defaults to KATANA_ETH_CONTRACT_ADDRESS.
 * @param prefundAmount - The amount to be transferred to the destination account.
 * @param transactionDetails - Additional transaction details to be included in the transaction.
 *
 * @returns - Returns the result of the transfer transaction, typically including transaction details.
 *
 * @throws - Throws an error if the transaction does not complete successfully.
 */
export const prefundAccount = async (
    address: string,
    account: AccountInterface,
    feeTokenAddress: string,
    prefundAmount: string,
    transactionDetails?: InvocationsDetails
): Promise<any> => {
    try {
        // Configure the options for the transfer transaction
        const transferOptions = {
            contractAddress: feeTokenAddress,
            entrypoint: "transfer",
            calldata: CallData.compile([address, prefundAmount, "0x0"]),
        };

        // Retrieve the nonce for the account to avoid transaction collisions
        const nonce = await account.getNonce();
        // Initiate the transaction
        const { transaction_hash } = await account.execute(
            [transferOptions],
            undefined,
            {
                maxFee: 0,
                nonce,
                ...transactionDetails,
            }
        );

        // Wait for the transaction to complete and check its status
        const result = await account.waitForTransaction(transaction_hash, {
            retryInterval: 1000,
            successStates: [TransactionFinalityStatus.ACCEPTED_ON_L2],
        });

        if (!result) {
            throw new Error("Transaction did not complete successfully.");
        }

        return result;
    } catch (error) {
        console.error(error);
        throw error;
    }
};
