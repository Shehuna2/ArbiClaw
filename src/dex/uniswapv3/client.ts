import { Contract, JsonRpcProvider } from 'ethers';
import { FACTORY_ABI, QUOTER_V2_ABI } from './abi.js';
import { UNI_V3_ADDRESSES } from './addresses.js';

export interface UniV3Client {
  provider: JsonRpcProvider;
  factory: Contract;
  quoterV2: Contract;
}

export const createUniV3Client = (rpcUrl: string): UniV3Client => {
  const provider = new JsonRpcProvider(rpcUrl);
  return {
    provider,
    factory: new Contract(UNI_V3_ADDRESSES.FACTORY, FACTORY_ABI, provider),
    quoterV2: new Contract(UNI_V3_ADDRESSES.QUOTER_V2, QUOTER_V2_ABI, provider)
  };
};
