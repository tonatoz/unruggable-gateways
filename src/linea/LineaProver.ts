import type { HexString, ProofRef } from '../types.js';
import { BlockProver, makeStorageKey, type TargetNeed } from '../vm.js';
import { ZeroHash } from 'ethers/constants';
import { dataSlice, toBeHex } from 'ethers/utils';
import {
  ABI_CODER,
  NULL_CODE_HASH,
  sendImmediate,
  withResolvers,
} from '../utils.js';
import {
  isExistanceProof,
  type LineaProof,
  type RPCLineaGetProof,
} from './types.js';

//const NULL_CODE_HASH = '0x0134373b65f439c874734ff51ea349327c140cde2e47a933146e6f9f2ad8eb17'; // mimc(ZeroHash)

function isContract(accountProof: LineaProof) {
  return (
    isExistanceProof(accountProof) &&
    // https://github.com/Consensys/linea-monorepo/blob/a001342170768a22988a29b2dca8601199c6e205/contracts/contracts/lib/SparseMerkleProof.sol#L23
    dataSlice(accountProof.proof.value, 128, 160) !== NULL_CODE_HASH
  );
}

function encodeProof(proof: LineaProof) {
  return ABI_CODER.encode(
    ['tuple(uint256, bytes, bytes[])[]'],
    [
      isExistanceProof(proof)
        ? [[proof.leafIndex, proof.proof.value, proof.proof.proofRelatedNodes]]
        : [
            [
              proof.leftLeafIndex,
              proof.leftProof.value,
              proof.leftProof.proofRelatedNodes,
            ],
            [
              proof.rightLeafIndex,
              proof.rightProof.value,
              proof.rightProof.proofRelatedNodes,
            ],
          ],
    ]
  );
}

export class LineaProver extends BlockProver {
  override async getStorage(
    target: HexString,
    slot: bigint
  ): Promise<HexString> {
    target = target.toLowerCase();
    // check to see if we know this target isn't a contract
    const accountProof: LineaProof | undefined =
      await this.proofLRU.touch(target);
    if (accountProof && !isContract(accountProof)) {
      return ZeroHash;
    }
    // check to see if we've already have a proof for this value
    const storageKey = makeStorageKey(target, slot);
    const storageProof: LineaProof | undefined =
      await this.proofLRU.touch(storageKey);
    if (storageProof) {
      return isExistanceProof(storageProof)
        ? storageProof.proof.value
        : ZeroHash;
    }
    // we didn't have the proof
    if (this.cache) {
      return this.cache.get(storageKey, () =>
        this.provider.getStorage(target, slot, this.block)
      );
    }
    const proof = await this.getProofs(target, [slot]);
    return isContract(proof.accountProof) &&
      isExistanceProof(proof.storageProofs[0])
      ? proof.storageProofs[0].proof.value
      : ZeroHash;
  }
  override async isContract(target: HexString) {
    if (this.cache) {
      return this.cache.get(target, async () => {
        const code = await this.provider.getCode(target, this.block);
        return code.length > 2;
      });
    } else {
      const { accountProof } = await this.getProofs(target);
      return isContract(accountProof);
    }
  }
  protected override async _proveNeed(
    need: TargetNeed,
    accountRef: ProofRef,
    slotRefs: Map<bigint, ProofRef>
  ) {
    const m = [...slotRefs];
    const accountProof: LineaProof | undefined = await this.proofLRU.peek(
      need.target
    );
    if (accountProof && !isContract(accountProof)) m.length = 0;
    const proofs = await this.getProofs(
      need.target,
      m.map(([slot]) => slot)
    );
    accountRef.proof = encodeProof(proofs.accountProof);
    if (isContract(proofs.accountProof)) {
      m.forEach(
        ([, ref], i) => (ref.proof = encodeProof(proofs.storageProofs[i]))
      );
    }
  }
  async getProofs(
    target: HexString,
    slots: bigint[] = []
  ): Promise<RPCLineaGetProof> {
    target = target.toLowerCase();
    // there are (3) cases:
    // 1.) account doesn't exist
    // 2.) account is EOA
    // 3.) account is contract
    const missing: number[] = [];
    const { promise, resolve, reject } = withResolvers();
    // check if we have an account proof
    let accountProof: Promise<LineaProof> | LineaProof | undefined =
      this.proofLRU.touch(target);
    if (!accountProof) {
      // missing account proof, so block it
      this.proofLRU.setPending(
        target,
        promise.then(() => accountProof)
      );
    }
    // check if we're missing any slots
    const storageProofs: (Promise<LineaProof> | LineaProof | undefined)[] =
      slots.map((slot, i) => {
        const key = makeStorageKey(target, slot);
        const p = this.proofLRU.touch(key);
        if (!p) {
          // missing storage proof, so block it
          this.proofLRU.setPending(
            key,
            promise.then(() => storageProofs[i])
          );
          missing.push(i);
        }
        return p;
      });
    // check if we need something
    if (!accountProof || missing.length) {
      try {
        const { storageProofs: v, accountProof: a } = await this.fetchProofs(
          target,
          missing.map((x) => slots[x])
        );
        // update the blocked values
        accountProof = a;
        missing.forEach((x, i) => (storageProofs[x] = v[i]));
        resolve();
      } catch (err) {
        reject(err);
        throw err; // must throw because accountProof is undefined
      }
    } else {
      accountProof = await accountProof;
    }
    // nuke the proofs if we dont exist
    if (!isContract(accountProof)) {
      storageProofs.length = 0;
    }
    // reassemble
    return {
      accountProof,
      storageProofs: (await Promise.all(storageProofs)) as LineaProof[],
    };
  }
  async fetchProofs(target: HexString, slots: bigint[] = []) {
    const ps = [];
    for (let i = 0; ; ) {
      ps.push(
        // 20240825: most cloud providers seem to reject batched getProof
        // since we aren't in control of provider construction (ie. batchMaxSize)
        // sendImmediate is a temporary hack to avoid this issue
        sendImmediate<RPCLineaGetProof>(this.provider, 'linea_getProof', [
          target,
          slots
            .slice(i, (i += this.proofBatchSize))
            .map((slot) => toBeHex(slot, 32)),
          this.block,
        ])
      );
      if (i >= slots.length) break;
    }
    const vs = await Promise.all(ps);
    for (let i = 1; i < vs.length; i++) {
      vs[0].storageProofs.push(...vs[i].storageProofs);
    }
    return vs[0];
  }
}
