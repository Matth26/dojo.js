import { KATANA_ETH_CONTRACT_ADDRESS } from "@dojoengine/core";
import {
    Account,
    CallData,
    ec,
    hash,
    InvocationsDetails,
    RpcProvider,
    shortString,
    stark,
} from "starknet";
import {
    Burner,
    BurnerCreateOptions,
    BurnerManagerOptions,
    BurnerStorage,
    BurnerKeys,
} from "../types";
import Storage from "../utils/storage";
import { derivePrivateKeyFromSeed } from "../utils/keyDerivation";
import { prefundAccount } from "./prefundAccount";
import { emptyAccount } from "./emptyAccount";

export const PREFUND_AMOUNT = "0x2386f26fc10000"; // 10000000000000000 = 0.1 ETH

/**
 * A class to manage Burner accounts.
 * This class exposes methods and properties to manage Burner accounts.
 * This class uses LocalStorage to store the Burner accounts.
 * You can use this class to build your own Burner Wallet in any js framework.
 *
 * @example
 *
 * ```ts
 * export const createBurner = async () => {
 *     const rpcProvider = new RpcProvider({
 *          nodeUrl: import.meta.env.VITE_PUBLIC_NODE_URL!,
 *    });
 *
 *  const masterAccount = new Account(
 *      rpcProvider,
 *      import.meta.env.VITE_PUBLIC_MASTER_ADDRESS!,
 *      import.meta.env.VITE_PUBLIC_MASTER_PRIVATE_KEY!,
 *      "1"
 *   );
 *
 *   const burnerManager = new BurnerManager({
 *      masterAccount,
 *      accountClassHash: import.meta.env.VITE_PUBLIC_ACCOUNT_CLASS_HASH!,
 *      rpcProvider,
 *   });
 *
 *   try {
 *           await burnerManager.init();
 *           if (burnerManager.list().length === 0) {
 *                 await burnerManager.create();
 *           }
 *       } catch (e) {
 *           console.log(e);
 *       }
 *   }
 *
 *  return {
 *      account: burnerManager.account as Account,
 *      burnerManager,
 *   };
 * };
 *
 *
 */

export class BurnerManager {
    public masterAccount: Account;
    public accountClassHash: string;
    public feeTokenAddress: string;
    public provider: RpcProvider;
    public chainId: string = "";

    public account: Account | null = null;
    public isDeploying: boolean = false;
    public isInitialized: boolean = false;

    private setIsDeploying?: (isDeploying: boolean) => void;
    private afterDeploying?: ({
        account,
        deployTx,
    }: {
        account: Account;
        deployTx: string;
    }) => Promise<void>;

    constructor({
        masterAccount,
        accountClassHash,
        feeTokenAddress = KATANA_ETH_CONTRACT_ADDRESS,
        rpcProvider,
    }: BurnerManagerOptions) {
        this.masterAccount = masterAccount;
        this.accountClassHash = accountClassHash;
        this.feeTokenAddress = feeTokenAddress;
        this.provider = rpcProvider;
    }

    public setIsDeployingCallback(
        callback: (isDeploying: boolean) => void
    ): void {
        this.setIsDeploying = callback;
    }

    public setAfterDeployingCallback(
        callback: ({
            account,
            deployTx,
        }: {
            account: Account;
            deployTx: string;
        }) => Promise<void>
    ): void {
        this.afterDeploying = callback;
    }

    private updateIsDeploying(status: boolean) {
        this.isDeploying = status;
        if (this.setIsDeploying) {
            this.setIsDeploying(status);
        }
    }

    private getBurnerKey(): string {
        return `burners_${this.chainId}`;
    }

    private getBurnerStorage(): BurnerStorage {
        return Storage.get(this.getBurnerKey()) || {};
    }

    private setActiveBurnerAccount(storage: BurnerStorage): void {
        for (let address in storage) {
            if (storage[address].active) {
                this.account = new Account(
                    this.provider,
                    address,
                    storage[address].privateKey,
                    "1"
                );
                return;
            }
        }
    }

    private async isBurnerDeployed(deployTx: string): Promise<boolean> {
        try {
            const receipt =
                await this.masterAccount.getTransactionReceipt(deployTx);
            return receipt !== null;
        } catch (error) {
            return false;
        }
    }

    public async init(keepNonDeployed = false): Promise<void> {
        if (this.isInitialized) {
            throw new Error("BurnerManager is already initialized");
        }
        this.chainId = shortString.decodeShortString(
            (await this.provider.getChainId()) as string
        );
        const storage = this.getBurnerStorage();
        const addresses = Object.keys(storage);

        const checks = addresses.map(async (address) => {
            const isDeployed = await this.isBurnerDeployed(
                storage[address].deployTx
            );
            return isDeployed ? null : address;
        });

        const toRemove = (await Promise.all(checks)).filter(
            (address): address is string => address !== null
        );

        toRemove.forEach((address) => {
            if (!keepNonDeployed) {
                console.log(
                    `Removing non-deployed burner at address ${address}.`
                );
                delete storage[address];
            }
        });

        if (Object.keys(storage).length) {
            Storage.set(this.getBurnerKey(), storage);
            this.setActiveBurnerAccount(storage); // Re-select the active burner account
        } else {
            this.clear();
        }

        this.isInitialized = true;
    }

    public list(): Burner[] {
        const storage = this.getBurnerStorage();
        return Object.keys(storage)
            .map((address) => {
                return {
                    address,
                    active: storage[address].active,
                    masterAccount: storage[address].masterAccount,
                    accountIndex: storage[address].accountIndex,
                };
            })
            .filter(
                (burner) => burner.masterAccount === this.masterAccount.address
            );
    }

    public select(address: string): void {
        const storage = this.getBurnerStorage();
        if (!storage[address]) {
            throw new Error("burner not found");
        }

        for (let addr in storage) {
            storage[addr].active = false;
        }
        storage[address].active = true;

        Storage.set(this.getBurnerKey(), storage);
        this.account = new Account(
            this.provider,
            address,
            storage[address].privateKey,
            "1"
        );
    }

    public deselect(): void {
        const storage = this.getBurnerStorage();
        for (let addr in storage) {
            storage[addr].active = false;
        }
        Storage.set(this.getBurnerKey(), storage);
        this.account = null;
    }

    public get(address: string): Account {
        const storage = this.getBurnerStorage();
        if (!storage[address]) {
            throw new Error("burner not found");
        }

        return new Account(
            this.provider,
            address,
            storage[address].privateKey,
            "1"
        );
    }

    public async delete(
        address: string,
        transactionDetails?: InvocationsDetails
    ): Promise<void> {
        const storage = this.getBurnerStorage();
        if (!storage[address]) {
            throw new Error("burner not found");
        }

        try {
            await emptyAccount(
                this.provider,
                this.masterAccount.address,
                this.get(address),
                this.feeTokenAddress,
                transactionDetails
            );
        } catch (e) {
            console.error(
                `burner manager delete() while emptying account error:`,
                e
            );
            return;
        }

        delete storage[address];
        Storage.set(this.getBurnerKey(), storage);

        // Check if there are any remaining burners
        const remainingAddresses = Object.keys(storage);
        if (remainingAddresses.length > 0) {
            // Select the first remaining burner as the active account
            this.select(remainingAddresses[0]);
        } else {
            this.account = null;
        }
    }

    public async clear(transactionDetails?: InvocationsDetails): Promise<void> {
        const storage = this.getBurnerStorage();
        const addresses = Object.keys(storage);

        const deletePromises = addresses.map((address) =>
            this.delete(address, transactionDetails)
        );

        await Promise.all(deletePromises);

        Storage.remove(this.getBurnerKey());
    }

    getActiveAccount(): Account | null {
        const storage = this.getBurnerStorage();
        for (let address in storage) {
            if (storage[address].active) {
                return new Account(
                    this.provider,
                    address,
                    storage[address].privateKey,
                    "1"
                );
            }
        }
        return null;
    }

    public generateKeysAndAddress(options?: BurnerCreateOptions): BurnerKeys {
        const privateKey = options?.secret
            ? derivePrivateKeyFromSeed(options.secret, options.index || 0)
            : stark.randomAddress();
        const publicKey = ec.starkCurve.getStarkKey(privateKey);
        return {
            privateKey,
            publicKey,
            address: hash.calculateContractAddressFromHash(
                publicKey,
                this.accountClassHash,
                CallData.compile({ publicKey }),
                0
            ),
        };
    }

    public async create(options?: BurnerCreateOptions): Promise<Account> {
        if (!this.isInitialized) {
            throw new Error("BurnerManager is not initialized");
        }

        this.updateIsDeploying(true);

        const { privateKey, publicKey, address } =
            this.generateKeysAndAddress(options);

        if (!this.masterAccount) {
            throw new Error("wallet account not found");
        }
        try {
            await prefundAccount(
                address,
                this.masterAccount,
                this.feeTokenAddress,
                options?.prefundedAmount || PREFUND_AMOUNT,
                options?.transactionDetails
            );
        } catch (e) {
            console.error(`burner manager create() error:`, e);
            this.updateIsDeploying(false);
        }

        const accountOptions = {
            classHash: this.accountClassHash,
            constructorCalldata: CallData.compile({ publicKey }),
            addressSalt: publicKey,
        };

        // deploy burner
        const burner = new Account(this.provider, address, privateKey, "1");

        let deployTx = "";
        try {
            const nonce = await this.account?.getNonce();
            const { transaction_hash } = await burner.deployAccount(
                accountOptions,
                {
                    maxFee: 0,
                    nonce,
                    ...options?.transactionDetails,
                }
            );
            deployTx = transaction_hash;
        } catch (error) {
            this.updateIsDeploying(false);
            throw error;
        }

        // check if account is already deployed
        let isDeployed = false;
        try {
            isDeployed = await this.isBurnerDeployed(deployTx);
        } catch {}

        // wait to deploy
        if (!isDeployed) {
            const receipt = await this.masterAccount.waitForTransaction(
                deployTx,
                {
                    retryInterval: 100,
                }
            );
            if (!receipt) {
                throw new Error("Transaction did not complete successfully.");
            }
        }

        const storage = this.getBurnerStorage();
        for (let address in storage) {
            storage[address].active = false;
        }

        storage[address] = {
            chainId: this.chainId,
            privateKey,
            publicKey,
            deployTx,
            masterAccount: this.masterAccount.address,
            active: true,
        };

        if (options?.secret) {
            storage[address].accountIndex = options.index;
        }
        if (options?.metadata) {
            storage[address].metadata = options.metadata;
        }

        this.account = burner;
        this.updateIsDeploying(false);
        Storage.set(this.getBurnerKey(), storage);

        if (this.afterDeploying) {
            try {
                await this.afterDeploying({ account: this.account, deployTx });
            } catch (e: any) {
                console.log("error on afterDeploying", e);
            }
        }

        return burner;
    }

    public async copyBurnersToClipboard(): Promise<void> {
        const burners = this.getBurnerStorage();
        try {
            await navigator.clipboard.writeText(JSON.stringify(burners));
        } catch (error) {
            throw error;
        }
    }

    public async setBurnersFromClipboard(): Promise<void> {
        try {
            const text = await navigator.clipboard.readText();
            const burners: BurnerStorage = JSON.parse(text);

            // Assume no burner is active
            let activeAddress: string | null = null;

            // Iterate over the pasted burners to find the active one
            for (const [address, burner] of Object.entries(burners)) {
                if (burner.active) {
                    activeAddress = address;
                    break;
                }
            }

            Storage.set(this.getBurnerKey(), burners);

            // If there's an active burner, select it
            if (activeAddress) {
                this.select(activeAddress);
            }
        } catch (error) {
            throw error;
        }
    }
}
