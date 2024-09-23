import type { RollupDeployment } from '../rollup.js';
import type { HexAddress, ProviderPair } from '../types.js';
import { type ABIOutputProposal, ORACLE_ABI } from './types.js';
import { Contract } from 'ethers/contract';
import { CHAINS } from '../chains.js';
import { AbstractOPRollup, type OPCommit } from './AbstractOPRollup.js';
import { toUnpaddedHex } from '../utils.js';

// should this be named L2OutputOracleProxy?
// most call it L2OutputOracle (meaning the Proxy)
// but some list both for some stupid reason
export type OPConfig = {
  L2OutputOracle: HexAddress;
};

export class OPRollup extends AbstractOPRollup {
  // https://docs.base.org/docs/base-contracts#base-mainnet
  static readonly baseMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.BASE,
    L2OutputOracle: '0x56315b90c40730925ec5485cf004d835058518A0',
  };

  // https://docs.blast.io/building/contracts#mainnet
  static readonly blastMainnnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.BLAST,
    L2OutputOracle: '0x826D1B0D4111Ad9146Eb8941D7Ca2B6a44215c76',
  };

  // https://docs.frax.com/fraxtal/addresses/fraxtal-contracts#mainnet
  static readonly fraxtalMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.FRAXTAL,
    L2OutputOracle: '0x66CC916Ed5C6C2FA97014f7D1cD141528Ae171e4',
  };

  // https://docs.zora.co/zora-network/network#zora-network-mainnet-1
  static readonly zoraMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.ZORA,
    L2OutputOracle: '0x9E6204F750cD866b299594e2aC9eA824E2e5f95c',
  };

  // https://docs-v2.mantle.xyz/intro/system-components/on-chain-system
  static readonly mantleMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.MANTLE,
    L2OutputOracle: '0x31d543e7BE1dA6eFDc2206Ef7822879045B9f481',
  };

  // https://docs.mode.network/general-info/mainnet-contract-addresses/l1-l2-contracts
  static readonly modeMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.MODE,
    L2OutputOracle: '0x4317ba146D4933D889518a3e5E11Fe7a53199b04',
  };

  // https://docs.cyber.co/build-on-cyber/addresses-mainnet
  // https://docs.cyber.co/build-on-cyber/addresses-testnet
  static readonly cyberMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.MODE,
    L2OutputOracle: '0xD94Ce9E4886A6dcEbC7cF993f4b38F5276516643',
  };

  // https://redstone.xyz/docs/contract-addresses
  static readonly redstoneMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.REDSTONE,
    L2OutputOracle: '0xa426A052f657AEEefc298b3B5c35a470e4739d69',
  };

  readonly L2OutputOracle;
  constructor(providers: ProviderPair, config: OPConfig) {
    super(providers);
    this.L2OutputOracle = new Contract(
      config.L2OutputOracle,
      ORACLE_ABI,
      providers.provider1
    );
  }

  override async fetchLatestCommitIndex(): Promise<bigint> {
    return this.L2OutputOracle.latestOutputIndex({
      blockTag: this.latestBlockTag,
    });
  }
  protected override async _fetchParentCommitIndex(
    commit: OPCommit
  ): Promise<bigint> {
    return commit.index - 1n;
  }
  protected override async _fetchCommit(index: bigint) {
    // this fails with ARRAY_RANGE_ERROR when invalid
    const output: ABIOutputProposal =
      await this.L2OutputOracle.getL2Output(index);
    return this.createCommit(index, toUnpaddedHex(output.l2BlockNumber));
  }

  override windowFromSec(sec: number): number {
    // finalization time is on-chain
    // https://github.com/ethereum-optimism/optimism/blob/a81de910dc2fd9b2f67ee946466f2de70d62611a/packages/contracts-bedrock/src/L1/L2OutputOracle.sol#L231
    return sec;
  }
}
