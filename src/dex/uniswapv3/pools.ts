import { Contract } from 'ethers';
import { Address } from '../../core/types.js';

let factoryContract: Contract | undefined;

export const bindUniV3Factory = (factory: Contract) => {
  factoryContract = factory;
};

export const isZeroAddress = (addr: string): boolean => addr.toLowerCase() === '0x0000000000000000000000000000000000000000';

export const getPoolAddress = async (tokenA: Address, tokenB: Address, fee: number): Promise<string> => {
  if (!factoryContract) throw new Error('UniswapV3 factory not bound');
  return factoryContract.getPool(tokenA, tokenB, fee);
};

export const hasPool = async (tokenA: Address, tokenB: Address, fee: number): Promise<boolean> => {
  const pool = await getPoolAddress(tokenA, tokenB, fee);
  return !isZeroAddress(pool);
};
