import { BlockchainLifecycle } from '@0xproject/dev-utils';
import { BigNumber } from '@0xproject/utils';
import * as chai from 'chai';
import { LogWithDecodedArgs } from 'ethereum-types';

import {
    AssetProxyOwnerContract,
    AssetProxyRegistrationContractEventArgs,
    ExecutionContractEventArgs,
    ExecutionFailureContractEventArgs,
    SubmissionContractEventArgs,
} from '../src/generated_contract_wrappers/asset_proxy_owner';
import { MixinAuthorizableContract } from '../src/generated_contract_wrappers/mixin_authorizable';
import { TestAssetProxyOwnerContract } from '../src/generated_contract_wrappers/test_asset_proxy_owner';
import { artifacts } from '../src/utils/artifacts';
import {
    expectRevertOrAlwaysFailingTransactionAsync,
    expectRevertOrContractCallFailedAsync,
} from '../src/utils/assertions';
import { chaiSetup } from '../src/utils/chai_setup';
import { constants } from '../src/utils/constants';
import { increaseTimeAndMineBlockAsync } from '../src/utils/increase_time';
import { MultiSigWrapper } from '../src/utils/multi_sig_wrapper';
import { provider, txDefaults, web3Wrapper } from '../src/utils/web3_wrapper';

chaiSetup.configure();
const expect = chai.expect;
const blockchainLifecycle = new BlockchainLifecycle(web3Wrapper);
// tslint:disable:no-unnecessary-type-assertion
describe('AssetProxyOwner', () => {
    let owners: string[];
    let authorized: string;
    const REQUIRED_APPROVALS = new BigNumber(2);
    const SECONDS_TIME_LOCKED = new BigNumber(1000000);

    let erc20Proxy: MixinAuthorizableContract;
    let erc721Proxy: MixinAuthorizableContract;
    let testAssetProxyOwner: TestAssetProxyOwnerContract;
    let multiSigWrapper: MultiSigWrapper;

    before(async () => {
        await blockchainLifecycle.startAsync();
    });
    after(async () => {
        await blockchainLifecycle.revertAsync();
    });
    before(async () => {
        const accounts = await web3Wrapper.getAvailableAddressesAsync();
        owners = [accounts[0], accounts[1]];
        const initialOwner = (authorized = accounts[0]);
        erc20Proxy = await MixinAuthorizableContract.deployFrom0xArtifactAsync(
            artifacts.MixinAuthorizable,
            provider,
            txDefaults,
        );
        erc721Proxy = await MixinAuthorizableContract.deployFrom0xArtifactAsync(
            artifacts.MixinAuthorizable,
            provider,
            txDefaults,
        );
        const defaultAssetProxyContractAddresses: string[] = [];
        testAssetProxyOwner = await TestAssetProxyOwnerContract.deployFrom0xArtifactAsync(
            artifacts.TestAssetProxyOwner,
            provider,
            txDefaults,
            owners,
            defaultAssetProxyContractAddresses,
            REQUIRED_APPROVALS,
            SECONDS_TIME_LOCKED,
        );
        multiSigWrapper = new MultiSigWrapper(testAssetProxyOwner, provider);
        await web3Wrapper.awaitTransactionSuccessAsync(
            await erc20Proxy.transferOwnership.sendTransactionAsync(testAssetProxyOwner.address, {
                from: initialOwner,
            }),
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
        await web3Wrapper.awaitTransactionSuccessAsync(
            await erc721Proxy.transferOwnership.sendTransactionAsync(testAssetProxyOwner.address, {
                from: initialOwner,
            }),
            constants.AWAIT_TRANSACTION_MINED_MS,
        );
    });
    beforeEach(async () => {
        await blockchainLifecycle.startAsync();
    });
    afterEach(async () => {
        await blockchainLifecycle.revertAsync();
    });

    describe('constructor', () => {
        it('should register passed in assetProxyContracts', async () => {
            const assetProxyContractAddresses = [erc20Proxy.address, erc721Proxy.address];
            const newMultiSig = await AssetProxyOwnerContract.deployFrom0xArtifactAsync(
                artifacts.AssetProxyOwner,
                provider,
                txDefaults,
                owners,
                assetProxyContractAddresses,
                REQUIRED_APPROVALS,
                SECONDS_TIME_LOCKED,
            );
            const isErc20ProxyRegistered = await newMultiSig.isAssetProxyRegistered.callAsync(erc20Proxy.address);
            const isErc721ProxyRegistered = await newMultiSig.isAssetProxyRegistered.callAsync(erc721Proxy.address);
            expect(isErc20ProxyRegistered).to.equal(true);
            expect(isErc721ProxyRegistered).to.equal(true);
        });
        it('should throw if a null address is included in assetProxyContracts', async () => {
            const assetProxyContractAddresses = [erc20Proxy.address, constants.NULL_ADDRESS];
            return expectRevertOrAlwaysFailingTransactionAsync(
                AssetProxyOwnerContract.deployFrom0xArtifactAsync(
                    artifacts.AssetProxyOwner,
                    provider,
                    txDefaults,
                    owners,
                    assetProxyContractAddresses,
                    REQUIRED_APPROVALS,
                    SECONDS_TIME_LOCKED,
                ),
            );
        });
    });

    describe('isFunctionRemoveAuthorizedAddressAtIndex', () => {
        it('should return false if data is not for removeAuthorizedAddressAtIndex', async () => {
            const notRemoveAuthorizedAddressData = erc20Proxy.addAuthorizedAddress.getABIEncodedTransactionData(
                owners[0],
            );

            const isFunctionRemoveAuthorizedAddressAtIndex = await testAssetProxyOwner.isFunctionRemoveAuthorizedAddressAtIndex.callAsync(
                notRemoveAuthorizedAddressData,
            );
            expect(isFunctionRemoveAuthorizedAddressAtIndex).to.be.false();
        });

        it('should return true if data is for removeAuthorizedAddressAtIndex', async () => {
            const index = new BigNumber(0);
            const removeAuthorizedAddressAtIndexData = erc20Proxy.removeAuthorizedAddressAtIndex.getABIEncodedTransactionData(
                owners[0],
                index,
            );
            const isFunctionRemoveAuthorizedAddressAtIndex = await testAssetProxyOwner.isFunctionRemoveAuthorizedAddressAtIndex.callAsync(
                removeAuthorizedAddressAtIndexData,
            );
            expect(isFunctionRemoveAuthorizedAddressAtIndex).to.be.true();
        });
    });

    describe('registerAssetProxy', () => {
        it('should throw if not called by multisig', async () => {
            const isRegistered = true;
            return expectRevertOrAlwaysFailingTransactionAsync(
                testAssetProxyOwner.registerAssetProxy.sendTransactionAsync(erc20Proxy.address, isRegistered, {
                    from: owners[0],
                }),
            );
        });

        it('should register an address if called by multisig after timelock', async () => {
            const addressToRegister = erc20Proxy.address;
            const isRegistered = true;
            const registerAssetProxyData = testAssetProxyOwner.registerAssetProxy.getABIEncodedTransactionData(
                addressToRegister,
                isRegistered,
            );
            const submitTxRes = await multiSigWrapper.submitTransactionAsync(
                testAssetProxyOwner.address,
                registerAssetProxyData,
                owners[0],
            );

            const log = submitTxRes.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
            const txId = log.args.transactionId;

            await multiSigWrapper.confirmTransactionAsync(txId, owners[1]);
            await increaseTimeAndMineBlockAsync(SECONDS_TIME_LOCKED.toNumber());

            const executeTxRes = await multiSigWrapper.executeTransactionAsync(txId, owners[0]);
            const registerLog = executeTxRes.logs[0] as LogWithDecodedArgs<AssetProxyRegistrationContractEventArgs>;
            expect(registerLog.args.assetProxyContract).to.equal(addressToRegister);
            expect(registerLog.args.isRegistered).to.equal(isRegistered);

            const isAssetProxyRegistered = await testAssetProxyOwner.isAssetProxyRegistered.callAsync(
                addressToRegister,
            );
            expect(isAssetProxyRegistered).to.equal(isRegistered);
        });

        it('should fail if registering a null address', async () => {
            const addressToRegister = constants.NULL_ADDRESS;
            const isRegistered = true;
            const registerAssetProxyData = testAssetProxyOwner.registerAssetProxy.getABIEncodedTransactionData(
                addressToRegister,
                isRegistered,
            );
            const submitTxRes = await multiSigWrapper.submitTransactionAsync(
                testAssetProxyOwner.address,
                registerAssetProxyData,
                owners[0],
            );
            const log = submitTxRes.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
            const txId = log.args.transactionId;

            await multiSigWrapper.confirmTransactionAsync(txId, owners[1]);
            await increaseTimeAndMineBlockAsync(SECONDS_TIME_LOCKED.toNumber());

            const executeTxRes = await multiSigWrapper.executeTransactionAsync(txId, owners[0]);
            const failureLog = executeTxRes.logs[0] as LogWithDecodedArgs<ExecutionFailureContractEventArgs>;
            expect(failureLog.args.transactionId).to.be.bignumber.equal(txId);

            const isAssetProxyRegistered = await testAssetProxyOwner.isAssetProxyRegistered.callAsync(
                addressToRegister,
            );
            expect(isAssetProxyRegistered).to.equal(false);
        });
    });

    describe('Calling removeAuthorizedAddressAtIndex', () => {
        const erc20Index = new BigNumber(0);
        const erc721Index = new BigNumber(1);
        before('authorize both proxies and register erc20 proxy', async () => {
            // Only register ERC20 proxy
            const addressToRegister = erc20Proxy.address;
            const isRegistered = true;
            const registerAssetProxyData = testAssetProxyOwner.registerAssetProxy.getABIEncodedTransactionData(
                addressToRegister,
                isRegistered,
            );
            const registerAssetProxySubmitRes = await multiSigWrapper.submitTransactionAsync(
                testAssetProxyOwner.address,
                registerAssetProxyData,
                owners[0],
            );
            const registerAssetProxySubmitLog = registerAssetProxySubmitRes.logs[0] as LogWithDecodedArgs<
                SubmissionContractEventArgs
            >;
            const registerAssetProxyTxId = registerAssetProxySubmitLog.args.transactionId;
            await multiSigWrapper.confirmTransactionAsync(registerAssetProxyTxId, owners[1]);

            const addAuthorizedAddressData = erc20Proxy.addAuthorizedAddress.getABIEncodedTransactionData(authorized);
            const erc20AddAuthorizedAddressSubmitRes = await multiSigWrapper.submitTransactionAsync(
                erc20Proxy.address,
                addAuthorizedAddressData,
                owners[0],
            );
            const erc721AddAuthorizedAddressSubmitRes = await multiSigWrapper.submitTransactionAsync(
                erc721Proxy.address,
                addAuthorizedAddressData,
                owners[0],
            );
            const erc20AddAuthorizedAddressSubmitLog = erc20AddAuthorizedAddressSubmitRes.logs[0] as LogWithDecodedArgs<
                SubmissionContractEventArgs
            >;
            const erc721AddAuthorizedAddressSubmitLog = erc721AddAuthorizedAddressSubmitRes
                .logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
            const erc20AddAuthorizedAddressTxId = erc20AddAuthorizedAddressSubmitLog.args.transactionId;
            const erc721AddAuthorizedAddressTxId = erc721AddAuthorizedAddressSubmitLog.args.transactionId;

            await multiSigWrapper.confirmTransactionAsync(erc20AddAuthorizedAddressTxId, owners[1]);
            await multiSigWrapper.confirmTransactionAsync(erc721AddAuthorizedAddressTxId, owners[1]);
            await increaseTimeAndMineBlockAsync(SECONDS_TIME_LOCKED.toNumber());
            await multiSigWrapper.executeTransactionAsync(registerAssetProxyTxId, owners[0]);
            await multiSigWrapper.executeTransactionAsync(erc20AddAuthorizedAddressTxId, owners[0]);
            await multiSigWrapper.executeTransactionAsync(erc721AddAuthorizedAddressTxId, owners[0]);
        });

        describe('validRemoveAuthorizedAddressAtIndexTx', () => {
            it('should revert if data is not for removeAuthorizedAddressAtIndex and proxy is registered', async () => {
                const notRemoveAuthorizedAddressData = erc20Proxy.addAuthorizedAddress.getABIEncodedTransactionData(
                    authorized,
                );
                const submitTxRes = await multiSigWrapper.submitTransactionAsync(
                    erc20Proxy.address,
                    notRemoveAuthorizedAddressData,
                    owners[0],
                );
                const log = submitTxRes.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = log.args.transactionId;
                return expectRevertOrContractCallFailedAsync(
                    testAssetProxyOwner.testValidRemoveAuthorizedAddressAtIndexTx.callAsync(txId),
                );
            });

            it('should return true if data is for removeAuthorizedAddressAtIndex and proxy is registered', async () => {
                const removeAuthorizedAddressAtIndexData = erc20Proxy.removeAuthorizedAddressAtIndex.getABIEncodedTransactionData(
                    authorized,
                    erc20Index,
                );
                const submitTxRes = await multiSigWrapper.submitTransactionAsync(
                    erc20Proxy.address,
                    removeAuthorizedAddressAtIndexData,
                    owners[0],
                );
                const log = submitTxRes.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = log.args.transactionId;
                const isValidRemoveAuthorizedAddressAtIndexTx = await testAssetProxyOwner.testValidRemoveAuthorizedAddressAtIndexTx.callAsync(
                    txId,
                );
                expect(isValidRemoveAuthorizedAddressAtIndexTx).to.be.true();
            });

            it('should revert if data is for removeAuthorizedAddressAtIndex and proxy is not registered', async () => {
                const removeAuthorizedAddressAtIndexData = erc721Proxy.removeAuthorizedAddressAtIndex.getABIEncodedTransactionData(
                    authorized,
                    erc721Index,
                );
                const submitTxRes = await multiSigWrapper.submitTransactionAsync(
                    erc721Proxy.address,
                    removeAuthorizedAddressAtIndexData,
                    owners[0],
                );
                const log = submitTxRes.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = log.args.transactionId;
                return expectRevertOrContractCallFailedAsync(
                    testAssetProxyOwner.testValidRemoveAuthorizedAddressAtIndexTx.callAsync(txId),
                );
            });
        });

        describe('executeRemoveAuthorizedAddressAtIndex', () => {
            it('should throw without the required confirmations', async () => {
                const removeAuthorizedAddressAtIndexData = erc20Proxy.removeAuthorizedAddressAtIndex.getABIEncodedTransactionData(
                    authorized,
                    erc20Index,
                );
                const res = await multiSigWrapper.submitTransactionAsync(
                    erc20Proxy.address,
                    removeAuthorizedAddressAtIndexData,
                    owners[0],
                );
                const log = res.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = log.args.transactionId;

                return expectRevertOrAlwaysFailingTransactionAsync(
                    testAssetProxyOwner.executeRemoveAuthorizedAddressAtIndex.sendTransactionAsync(txId, {
                        from: owners[1],
                    }),
                );
            });

            it('should throw if tx destination is not registered', async () => {
                const removeAuthorizedAddressAtIndexData = erc721Proxy.removeAuthorizedAddressAtIndex.getABIEncodedTransactionData(
                    authorized,
                    erc721Index,
                );
                const res = await multiSigWrapper.submitTransactionAsync(
                    erc721Proxy.address,
                    removeAuthorizedAddressAtIndexData,
                    owners[0],
                );
                const log = res.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = log.args.transactionId;

                await multiSigWrapper.confirmTransactionAsync(txId, owners[1]);

                return expectRevertOrAlwaysFailingTransactionAsync(
                    testAssetProxyOwner.executeRemoveAuthorizedAddressAtIndex.sendTransactionAsync(txId, {
                        from: owners[1],
                    }),
                );
            });

            it('should throw if tx data is not for removeAuthorizedAddressAtIndex', async () => {
                const newAuthorized = owners[1];
                const addAuthorizedAddressData = erc20Proxy.addAuthorizedAddress.getABIEncodedTransactionData(
                    newAuthorized,
                );
                const res = await multiSigWrapper.submitTransactionAsync(
                    erc20Proxy.address,
                    addAuthorizedAddressData,
                    owners[0],
                );
                const log = res.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = log.args.transactionId;

                await multiSigWrapper.confirmTransactionAsync(txId, owners[1]);

                return expectRevertOrAlwaysFailingTransactionAsync(
                    testAssetProxyOwner.executeRemoveAuthorizedAddressAtIndex.sendTransactionAsync(txId, {
                        from: owners[1],
                    }),
                );
            });

            it('should execute removeAuthorizedAddressAtIndex for registered address if fully confirmed', async () => {
                const removeAuthorizedAddressAtIndexData = erc20Proxy.removeAuthorizedAddressAtIndex.getABIEncodedTransactionData(
                    authorized,
                    erc20Index,
                );
                const submitRes = await multiSigWrapper.submitTransactionAsync(
                    erc20Proxy.address,
                    removeAuthorizedAddressAtIndexData,
                    owners[0],
                );
                const submitLog = submitRes.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = submitLog.args.transactionId;

                await multiSigWrapper.confirmTransactionAsync(txId, owners[1]);

                const execRes = await multiSigWrapper.executeRemoveAuthorizedAddressAtIndexAsync(txId, owners[0]);
                const execLog = execRes.logs[0] as LogWithDecodedArgs<ExecutionContractEventArgs>;
                expect(execLog.args.transactionId).to.be.bignumber.equal(txId);

                const tx = await testAssetProxyOwner.transactions.callAsync(txId);
                const isExecuted = tx[3];
                expect(isExecuted).to.equal(true);

                const isAuthorized = await erc20Proxy.authorized.callAsync(authorized);
                expect(isAuthorized).to.equal(false);
            });

            it('should throw if already executed', async () => {
                const removeAuthorizedAddressAtIndexData = erc20Proxy.removeAuthorizedAddressAtIndex.getABIEncodedTransactionData(
                    authorized,
                    erc20Index,
                );
                const submitRes = await multiSigWrapper.submitTransactionAsync(
                    erc20Proxy.address,
                    removeAuthorizedAddressAtIndexData,
                    owners[0],
                );
                const submitLog = submitRes.logs[0] as LogWithDecodedArgs<SubmissionContractEventArgs>;
                const txId = submitLog.args.transactionId;

                await multiSigWrapper.confirmTransactionAsync(txId, owners[1]);

                const execRes = await multiSigWrapper.executeRemoveAuthorizedAddressAtIndexAsync(txId, owners[0]);
                const execLog = execRes.logs[0] as LogWithDecodedArgs<ExecutionContractEventArgs>;
                expect(execLog.args.transactionId).to.be.bignumber.equal(txId);

                const tx = await testAssetProxyOwner.transactions.callAsync(txId);
                const isExecuted = tx[3];
                expect(isExecuted).to.equal(true);

                return expectRevertOrAlwaysFailingTransactionAsync(
                    testAssetProxyOwner.executeRemoveAuthorizedAddressAtIndex.sendTransactionAsync(txId, {
                        from: owners[1],
                    }),
                );
            });
        });
    });
});
// tslint:enable:no-unnecessary-type-assertion
