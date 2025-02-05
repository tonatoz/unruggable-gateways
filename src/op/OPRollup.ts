import type { RollupDeployment } from '../rollup.js';
import type { HexAddress, HexString32, ProviderPair } from '../types.js';
import { ORACLE_ABI } from './types.js';
import { Contract } from 'ethers/contract';
import { CHAINS } from '../chains.js';
import { AbstractOPRollup, type AbstractOPCommit } from './AbstractOPRollup.js';
import { isEthersError } from '../utils.js';

export type OPConfig = {
  L2OutputOracle: HexAddress; // sometimes called L2OutputOracleProxy
  minAgeSec?: number; // if falsy, requires finalization
};

export type OPCommit = AbstractOPCommit & { output: ABIOutputTuple };

type ABIOutputTuple = {
  outputRoot: HexString32;
  timestamp: bigint;
  l2BlockNumber: bigint;
};

export class OPRollup extends AbstractOPRollup<OPCommit> {
  // 20241030: base changed to fault proofs
  // static readonly baseMainnetConfig: RollupDeployment<OPConfig> = {
  //   chain1: CHAINS.MAINNET,
  //   chain2: CHAINS.BASE,
  //   L2OutputOracle: '0x56315b90c40730925ec5485cf004d835058518A0',
  // };

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
    chain2: CHAINS.CYBER,
    L2OutputOracle: '0xa669A743b065828682eE16109273F5CFeF5e676d',
  };

  // https://redstone.xyz/docs/contract-addresses
  static readonly redstoneMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.REDSTONE,
    L2OutputOracle: '0xa426A052f657AEEefc298b3B5c35a470e4739d69',
  };

  // https://docs.shape.network/documentation/technical-details/contract-addresses#mainnet
  static readonly shapeMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.SHAPE,
    L2OutputOracle: '0x6Ef8c69CfE4635d866e3E02732068022c06e724D',
  };

  // https://docs.bnbchain.org/bnb-opbnb/core-concepts/opbnb-protocol-addresses/
  static readonly opBNBMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.BSC,
    chain2: CHAINS.OP_BNB,
    L2OutputOracle: '0x153CAB79f4767E2ff862C94aa49573294B13D169',
  };

  // https://storage.googleapis.com/cel2-rollup-files/alfajores/deployment-l1.json
  static readonly celoAlfajoresConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.HOLESKY,
    chain2: CHAINS.CELO_ALFAJORES,
    L2OutputOracle: '0x4a2635e9e4f6e45817b1D402ac4904c1d1752438',
  };

  // https://docs.worldcoin.org/world-chain/developers/world-chain-contracts
  static readonly worldMainnetConfig: RollupDeployment<OPConfig> = {
    chain1: CHAINS.MAINNET,
    chain2: CHAINS.WORLD,
    L2OutputOracle: '0x19A6d1E9034596196295CF148509796978343c5D',
  };

  readonly L2OutputOracle: Contract;
  readonly minAgeSec: number;
  constructor(providers: ProviderPair, config: OPConfig) {
    super(providers);
    this.L2OutputOracle = new Contract(
      config.L2OutputOracle,
      ORACLE_ABI,
      providers.provider1
    );
    this.minAgeSec = config.minAgeSec ?? 0;
  }

  override get unfinalized() {
    return !!this.minAgeSec; // nonzero => unfinalized
  }

  async fetchOutput(index: bigint): Promise<ABIOutputTuple | undefined> {
    try {
      // this panics with ARRAY_RANGE_ERROR when out of bounds
      return await this.L2OutputOracle.getL2Output(index);
    } catch (err) {
      if (isEthersError(err) && err.code === 'CALL_EXCEPTION') return;
      throw err;
    }
  }

  override async fetchLatestCommitIndex(): Promise<bigint> {
    // Retrieve finalization parameters from the oracle.
    const latestIndex: bigint = await this.L2OutputOracle.latestOutputIndex();
    const finalizationPeriod: bigint =
      await this.L2OutputOracle.finalizationPeriodSeconds();
    const submissionInterval: bigint =
      await this.L2OutputOracle.submissionInterval();
    const l2BlockTime: bigint = await this.L2OutputOracle.l2BlockTime();

    // If we want finalized commitments, step back by finalizationPeriod
    // Otherwise we use the passed config value, minAgeSec
    const minAgeToUse =
      BigInt(this.minAgeSec) === 0n
        ? finalizationPeriod
        : BigInt(this.minAgeSec);

    // The offset of what we estimate to be the latest appropiate commit
    // Assumes proposers are doing what they should be
    let indexOffset: bigint = minAgeToUse / (submissionInterval * l2BlockTime);

    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    // The timestamp before which a commit fits our requirements
    const validTimestamp = currentTimestamp - minAgeToUse;

    let lastValidIndex: bigint | null = null;

    while (indexOffset <= latestIndex) {
      // Get the approximate output index
      const index = latestIndex - indexOffset;
      if (index === 0n) break; // Prevent underflow

      const output = await this.L2OutputOracle.getL2Output(index);
      const outputTimestamp = BigInt(output.timestamp);

      // If this output is valid
      if (outputTimestamp <= validTimestamp) {
        // Track the most recent valid output
        lastValidIndex = index;

        // As we are working with estimates we move closer to head and check again
        if (index < latestIndex) {
          indexOffset--;
          continue;
        } else {
          break; // We are already at the latest, return now
        }
      } else {
        // Output too recent
        // If we previously found a valid output, return it now
        if (lastValidIndex !== null) {
          return lastValidIndex;
        }

        // Move further back to find a valid output
        indexOffset++;
      }
    }

    throw new Error('OP: no valid output found');
  }

  protected override async _fetchCommit(index: bigint) {
    const output = await this.fetchOutput(index);

    if (!output) throw new Error('invalid output');
    const commit = await this.createCommit(index, output.l2BlockNumber);
    return { ...commit, output };
  }
  override async isCommitStillValid(commit: OPCommit): Promise<boolean> {
    // see: L2OutputOracle.deleteL2Outputs()
    const output = await this.fetchOutput(commit.index);
    if (!output) return false; // out-of-bounds => deleted
    return output.outputRoot === commit.output.outputRoot; // unequal => replaced
  }

  override windowFromSec(sec: number): number {
    // finalization time is on-chain
    // https://github.com/ethereum-optimism/optimism/blob/a81de910dc2fd9b2f67ee946466f2de70d62611a/packages/contracts-bedrock/src/L1/L2OutputOracle.sol#L231
    return sec;
  }
}
