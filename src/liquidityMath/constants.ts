export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export const Q96 = 2n ** 96n;
export const MaxUint256 = 2n ** 256n - 1n;

/**
 * Convert hex string to bigint
 */
export function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}
