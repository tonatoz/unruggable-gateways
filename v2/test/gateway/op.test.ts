import { OPFaultGateway } from '../../src/gateway/OPFaultGateway.js';
import { serve } from '@resolverworks/ezccip';
import { Foundry } from '@adraffy/blocksmith';
import { createProvider, providerURL, CHAIN_OP } from '../../src/providers.js';
import { runSlotDataTests } from './tests.js';
import { describe, afterAll } from 'bun:test';

describe('op', async () => {
  const foundry = await Foundry.launch({
    fork: providerURL(1),
  });
  afterAll(() => foundry.shutdown());
  const gateway = OPFaultGateway.mainnet({
    provider1: foundry.provider,
    provider2: createProvider(CHAIN_OP),
    commitDelay: 0,
  });
  const ccip = await serve(gateway, { protocol: 'raw', port: 0 });
  afterAll(() => ccip.http.close());
  const verifier = await foundry.deploy({
    file: 'OPFaultVerifier',
    args: [[ccip.endpoint], gateway.OptimismPortal, gateway.commitDelay],
  });
  // https://optimistic.etherscan.io/address/0xf9d79d8c09d24e0C47E32778c830C545e78512CF
  const reader = await foundry.deploy({
    file: 'SlotDataReader',
    args: [verifier, '0xf9d79d8c09d24e0C47E32778c830C545e78512CF'],
  });
  runSlotDataTests(reader);
});
